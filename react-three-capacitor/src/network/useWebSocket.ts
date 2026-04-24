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
  setServerTickRateHz,
  getServerTickRateHz,
} from './positionBuffer'
import type { ServerMessage } from './types'
import { localWorld } from '../game/localWorld'
import { reifyGameMap } from '../game/GameMap'
import { ensureClientWorld } from '../game/clientWorld'

function getWsPath(): string {
  const path = window.location.pathname.replace(/^\/+/, '').replace(/\/+$/, '')
  // Observer paths pass through verbatim so the server routes them to the
  // observer handler rather than the player handler. Supports single-segment
  // (`hub`) and two-segment (`scenarios/{id}`, `scenariorun/{id}`) routing
  // keys embedded in the observer path.
  if (/^observe\/(hub|scenarios\/[^/]+|scenariorun\/[^/]+)\/\d+\/\d+$/.test(path)) return path
  // Replay paths likewise route to the replay handler by exact path.
  if (/^recordings\/\d+$/.test(path)) return path
  // Scenario and scenario-run paths forward verbatim as the routing key.
  if (/^scenarios\/[^/]+$/.test(path)) return path
  if (/^scenariorun\/[^/]+$/.test(path)) return path
  // Empty path (root URL) resolves to `hub` — the combined hub world fronting
  // the default target scenario with a solo initial hallway.
  if (path.length === 0) return 'hub'
  // `/loop` resolves to the infinite-hallway singleton orchestration.
  if (path === 'loop') return 'loop'
  return path
}

function readSrUidCookie(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)sr_uid=([0-9a-f-]{36})/)
  return m ? m[1] : null
}

function getWsUrl(): string {
  const wsPath = getWsPath()
  const envUrl = import.meta.env.VITE_WS_URL
  const base = envUrl
    ? `${envUrl}/${wsPath}`
    : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/${wsPath}`
  // Cross-origin WS (dev setup with VITE_WS_URL on a different port) drops
  // the sr_uid cookie, so forward it as a query param. The server prefers
  // the cookie when both are present.
  const uid = readSrUidCookie()
  return uid ? `${base}?uid=${uid}` : base
}

let singleton: WebSocketClient | null = null

function getClient(): WebSocketClient {
  if (!singleton) singleton = new WebSocketClient(getWsUrl())
  return singleton
}

export function useWebSocket(): void {
  const store = useGameStore()

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | null = null
    // Wait for the client World to finish initializing before opening the WS.
    // The very first server message is `world_reset`, which the client can
    // only apply once `localWorld.current` exists. Deferring the connect
    // avoids a race where the reset arrives before physics/world init.
    ensureClientWorld().then(() => {
      if (disposed) return
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
          setServerTickRateHz(msg.tickRateHz)
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
          pushMoveAck({ clientTick: msg.clientTick, serverTick: msg.serverTick, x: msg.x, z: msg.z, events: msg.events })
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
            const delayMs = ticksUntil * (1000 / getServerTickRateHz())
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

        case 'world_reset': {
          const w = localWorld.current
          if (w) {
            for (const id of w.getMapInstanceIds()) w.removeMap(id)
            for (const serialized of msg.maps) w.addMap(reifyGameMap(serialized))
            w.applyConnectionsSnapshot(msg.connections)
          }
          store.setGeometryObjects(msg.geometry)
          // Ack the reset so the server can proceed with post-transfer state
          // changes (e.g. the hub reveal that drops walls + enables the
          // cross-instance adjacency edge).
          getClient().send({ type: 'world_reset_ack' })
          break
        }

        case 'map_add': {
          const w = localWorld.current
          if (w) {
            w.addMap(reifyGameMap(msg.map))
            w.applyConnectionsSnapshot(msg.connections)
          }
          store.appendGeometryObjects(msg.geometry)
          break
        }

        case 'map_remove': {
          const w = localWorld.current
          if (w) w.removeMap(msg.mapInstanceId)
          store.removeGeometryForMap(msg.mapInstanceId)
          break
        }

        case 'connections_state': {
          const w = localWorld.current
          if (w) w.applyConnectionsSnapshot(msg.connections)
          break
        }

        case 'geometry_state': {
          const world = localWorld.current
          const localId = useGameStore.getState().playerId
          if (msg.perPlayer && localId) {
            store.applyLocalGeometryOverride(msg.updates)
            if (world) {
              for (const { id, visible } of msg.updates) {
                if (visible) world.toggleGeometryOn(id, localId)
                else world.toggleGeometryOff(id, localId)
              }
            }
          } else {
            store.applyGeometryUpdates(msg.updates)
            if (world) {
              for (const { id, visible } of msg.updates) {
                if (visible) world.toggleGeometryOn(id)
                else world.toggleGeometryOff(id)
              }
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

        case 'replay_ended':
          store.setObserverEndReason('replay_ended')
          break
      }
    })

      cleanup = () => { remove(); removeClose() }
    })
    return () => {
      disposed = true
      cleanup?.()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let sent = false
    const check = () => {
      const s = useGameStore.getState()
      if (sent) return
      if (s.sceneReady && s.connected) {
        sent = true
        getClient().send({ type: 'ready' })
      }
    }
    const unsub = useGameStore.subscribe(check)
    check()
    return () => unsub()
  }, [])
}

export function useWsSend() {
  const client = getClient()
  return {
    sendMove: (tick: number, inputs: import('./types').MoveInput[]) =>
      client.send({ type: 'move', tick, inputs }),
    sendChoice: (eventId: string, optionId: string) =>
      client.send({ type: 'choice', eventId, optionId }),
    sendReady: () => client.send({ type: 'ready' }),
  }
}

export function reconnectWs(): void {
  resetBuffers()
  useGameStore.getState().reset()
  const client = getClient()
  client.disconnect()
  client.connect()
}
