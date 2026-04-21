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

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080'

let singleton: WebSocketClient | null = null

function getClient(): WebSocketClient {
  if (!singleton) singleton = new WebSocketClient(WS_URL)
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
          store.addRemotePlayer(msg.playerId, msg.color, msg.animState)
          store.setPlayerHp(msg.playerId, msg.hp)
          pushRemotePosition(msg.playerId, msg.x, msg.z, estimatedServerTime())
          break

        case 'player_left':
          store.removeRemotePlayer(msg.playerId)
          clearRemotePlayer(msg.playerId)
          break

        case 'move_ack':
          setMoveAck(msg.seq, msg.x, msg.z, msg.events, msg.endTime)
          break

        case 'player_update':
          updateServerTime(msg.endTime)
          pushRemotePosition(msg.playerId, msg.x, msg.z, msg.endTime)
          pushRemoteEvents(msg.playerId, msg.events, msg.startTime, msg.endTime)
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
  }
}
