import { useEffect } from 'react'
import { WebSocketClient } from './WebSocketClient'
import { useGameStore } from '../store/gameStore'
import {
  pushMoveAck,
  pushRemotePosition,
  pushRemoteEvents,
  clearRemotePlayer,
  registerServerTick,
  resetBuffers,
  getRenderTick,
} from './positionBuffer'
import type { ServerMessage } from './types'
import { CURRENT_MAP } from '../../../content/maps'
import { localWorld } from '../game/localWorld'
import { TICK_RATE_HZ } from '../game/World'

function getWsUrl(): string {
  const scenarioPath = window.location.pathname.replace(/^\/+/, '') || 'demo'
  const envUrl = import.meta.env.VITE_WS_URL
  if (envUrl) return `${envUrl}/${scenarioPath}`
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/${scenarioPath}`
}

let singleton: WebSocketClient | null = null

function getClient(): WebSocketClient {
  if (!singleton) singleton = new WebSocketClient(getWsUrl())
  return singleton
}

export function useWebSocket(): void {
  const store = useGameStore()

  useEffect(() => {
    const client = getClient()
    client.connect()

    const removeClose = client.addCloseHandler(() => {
      // Only set disconnected if the server didn't already send an explicit observer_player_left.
      const s = useGameStore.getState()
      if (s.observerMode && s.observerEndReason === 'none') {
        s.setObserverEndReason('disconnected')
      }
    })

    const remove = client.addHandler((msg: ServerMessage) => {
      const isObserver = useGameStore.getState().observerMode

      switch (msg.type) {
        case 'welcome':
          registerServerTick(msg.serverTick)
          store.setPlayerId(msg.playerId)
          store.setLocalColor(msg.color)
          store.setInitialPosition(msg.x, msg.z)
          store.setPlayerHp(msg.playerId, msg.hp)
          store.setConnected(true)
          break

        case 'player_joined':
          registerServerTick(msg.serverTick)
          store.addRemotePlayer(msg.playerId, msg.color, msg.animState, msg.isNpc, msg.hasHealth ?? true)
          store.setPlayerHp(msg.playerId, msg.hp)
          pushRemotePosition(msg.playerId, msg.x, msg.z, msg.serverTick)
          localWorld.current?.addPlayer(msg.playerId, msg.x, msg.z)
          break

        case 'player_left':
          if (msg.playerId === useGameStore.getState().playerId) {
            // In observer mode observer_player_left carries the authoritative end reason.
            // Outside observer mode this means the server removed the local player.
            if (!isObserver) store.applyDamage(msg.playerId, 0)
          } else {
            store.removeRemotePlayer(msg.playerId)
            clearRemotePlayer(msg.playerId)
            localWorld.current?.removePlayer(msg.playerId)
          }
          break

        case 'move_ack':
          registerServerTick(msg.serverTick)
          pushMoveAck({ tick: msg.tick, x: msg.x, z: msg.z, events: msg.events, outOfOrder: msg.outOfOrder ?? false })
          break

        case 'player_update':
          registerServerTick(msg.serverTick)
          pushRemotePosition(msg.playerId, msg.x, msg.z, msg.serverTick)
          pushRemoteEvents(msg.playerId, msg.events, msg.serverTick)
          // Apply damage directly if the observed/local player is the target.
          // This handles both script-triggered damage and hits from other players.
          {
            const localId = useGameStore.getState().playerId
            if (localId) {
              for (const event of msg.events) {
                if (event.type === 'damage' && event.targetId === localId) {
                  useGameStore.getState().applyDamage(event.targetId, event.newHp)
                }
              }
            }
          }
          break

        case 'game_event':
          if (!isObserver) {
            // Defer until the render tick reaches the event's tick. Approximate
            // by converting tick-lag to ms at the fixed 20 Hz tick rate.
            const ticksUntil = Math.max(0, msg.serverTick - getRenderTick())
            const delayMs = ticksUntil * (1000 / TICK_RATE_HZ)
            setTimeout(() => {
              if (msg.event.type === 'show_choice') store.showChoice(msg.event)
              else if (msg.event.type === 'show_rule') store.showRule(msg.event)
            }, delayMs)
          }
          break

        case 'instruction':
          if (!isObserver) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const raw = msg as any
            const rules = msg.lines ?? (raw.text ? [{ label: raw.label, text: raw.text }] : [])
            store.showRule({ type: 'show_rule', eventId: `instruction-${Date.now()}`, rules })
          }
          break

        case 'map_init':
          store.setGeometryObjects(msg.geometry)
          break

        case 'geometry_state': {
          const world = localWorld.current
          const localId = useGameStore.getState().playerId
          if (msg.perPlayer && localId) {
            // Lock the local player to their current room before any turn-on toggle so
            // resolveOverlap ejects them toward their room, not the wrong side of a wall.
            if (world && msg.updates.some(u => u.visible)) world.lockCurrentRoom(localId)
            store.applyLocalGeometryOverride(msg.updates)
            if (world) {
              for (const { id, visible } of msg.updates) {
                if (visible) world.toggleGeometryOn(id, localId)
                else world.toggleGeometryOff(id, localId)
              }
            }
            if (world) world.unlockPlayerFromRoom(localId)
          } else {
            // For global toggles, lock every known player to their current room first.
            if (world && msg.updates.some(u => u.visible)) {
              for (const pid of world.players.keys()) world.lockCurrentRoom(pid)
            }
            store.applyGeometryUpdates(msg.updates)
            if (world) {
              for (const { id, visible } of msg.updates) {
                if (visible) world.toggleGeometryOn(id)
                else world.toggleGeometryOff(id)
              }
            }
            if (world && msg.updates.some(u => u.visible)) {
              for (const pid of world.players.keys()) world.unlockPlayerFromRoom(pid)
            }
            if (CURRENT_MAP.walkableVariants?.length) {
              const vis = useGameStore.getState().geometryVisibility
              let matched: import('../game/WorldSpec').WalkableArea | null = null
              for (const v of CURRENT_MAP.walkableVariants) {
                if (v.triggerIds.every(id => vis[id] === true)) { matched = v.walkable; break }
              }
              store.setActiveWalkable(matched)
            }
          }
          break
        }

        case 'room_visibility_state': {
          const localId = useGameStore.getState().playerId
          if (msg.perPlayer && localId) {
            store.applyPlayerRoomVisibilityOverride(msg.updates)
          } else {
            store.applyRoomVisibilityUpdates(msg.updates)
          }
          break
        }

        case 'button_init':
          store.initButtons(msg.buttons)
          break

        case 'button_state':
          store.applyButtonStateUpdate(msg.id, msg.state, msg.occupancy)
          break

        case 'button_config':
          store.applyButtonConfigUpdate(msg.id, msg.changes)
          break

        case 'add_rule':
          if (!isObserver) store.addRule(msg.text)
          break

        case 'notification':
          store.addNotification(msg.text)
          break

        case 'observer_player_left':
          store.setObserverEndReason(msg.eliminated ? 'eliminated' : 'disconnected')
          break
      }
    })

    return () => { remove(); removeClose() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

export function useWsSend() {
  const client = getClient()
  return {
    sendMove: (tick: number, inputs: import('./types').MoveInput[]) =>
      client.send({ type: 'move', tick, inputs }),
    sendChoiceAction: (eventId: string, optionId: string) =>
      client.send({ type: 'choice_action', eventId, optionId }),
  }
}

export function reconnectWs(): void {
  resetBuffers()
  useGameStore.getState().reset()
  const client = getClient()
  client.disconnect()
  client.connect()
}
