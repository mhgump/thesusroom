import { useEffect } from 'react'
import { WebSocketClient } from './WebSocketClient'
import { useGameStore } from '../store/gameStore'
import {
  setMoveAck,
  pushRemotePosition,
  pushRemoteEvents,
  clearRemotePlayer,
  updateServerTime,
  estimatedServerTime,
} from './positionBuffer'
import type { ServerMessage } from './types'
import { CURRENT_MAP } from '../../../content/client/maps'

function getWsUrl(): string {
  const scenarioPath = window.location.pathname.replace(/^\/+/, '') || 'demo'
  const base = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080'
  return `${base}/${scenarioPath}`
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

    const remove = client.addHandler((msg: ServerMessage) => {
      switch (msg.type) {
        case 'welcome':
          store.setPlayerId(msg.playerId)
          store.setLocalColor(msg.color)
          store.setInitialPosition(msg.x, msg.z)
          store.setPlayerHp(msg.playerId, msg.hp)
          store.setConnected(true)
          break

        case 'player_joined':
          store.addRemotePlayer(msg.playerId, msg.color, msg.animState, msg.isNpc, msg.hasHealth ?? true)
          store.setPlayerHp(msg.playerId, msg.hp)
          pushRemotePosition(msg.playerId, msg.x, msg.z, estimatedServerTime())
          break

        case 'player_left':
          if (msg.playerId === useGameStore.getState().playerId) {
            store.applyDamage(msg.playerId, 0)
          } else {
            store.removeRemotePlayer(msg.playerId)
            clearRemotePlayer(msg.playerId)
          }
          break

        case 'move_ack':
          setMoveAck(msg.seq, msg.x, msg.z, msg.events, msg.endTime)
          break

        case 'player_update':
          updateServerTime(msg.endTime)
          pushRemotePosition(msg.playerId, msg.x, msg.z, msg.endTime)
          pushRemoteEvents(msg.playerId, msg.events, msg.startTime, msg.endTime)
          break

        case 'game_event': {
          const delayMs = Math.max(0, msg.serverTime - estimatedServerTime())
          setTimeout(() => {
            if (msg.event.type === 'show_choice') store.showChoice(msg.event)
            else if (msg.event.type === 'show_rule') store.showRule(msg.event)
          }, delayMs)
          break
        }

        case 'instruction':
          store.showRule({
            type: 'show_rule',
            eventId: `instruction-${Date.now()}`,
            rules: [{ label: msg.label, text: msg.text }],
          })
          break

        case 'map_init':
          store.setGeometryObjects(msg.geometry)
          break

        case 'geometry_state':
          store.applyGeometryUpdates(msg.updates)
          if (CURRENT_MAP.walkableVariants?.length) {
            const vis = useGameStore.getState().geometryVisibility
            let matched: import('../game/WorldSpec').WalkableArea | null = null
            for (const v of CURRENT_MAP.walkableVariants) {
              if (v.triggerIds.every(id => vis[id] === true)) { matched = v.walkable; break }
            }
            store.setActiveWalkable(matched)
          }
          break

        case 'button_init':
          store.initButtons(msg.buttons)
          break

        case 'button_state':
          store.applyButtonStateUpdate(msg.id, msg.state, msg.occupancy)
          break

        case 'button_config':
          store.applyButtonConfigUpdate(msg.id, msg.changes)
          break

        case 'notification':
          store.addNotification(msg.text)
          break
      }
    })

    return () => { remove() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

export function useWsSend() {
  const client = getClient()
  return {
    sendMove: (seq: number, jx: number, jz: number, dt: number) =>
      client.send({ type: 'move', seq, jx, jz, dt }),
    sendChoiceAction: (eventId: string, optionId: string) =>
      client.send({ type: 'choice_action', eventId, optionId }),
  }
}
