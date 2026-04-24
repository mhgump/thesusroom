import WebSocket from 'ws'
import type { IncomingMessage } from 'http'
import type { ConnectionContext, ConnectionHandler } from './types.js'
import { parseObserverParams } from './urls.js'

// Read-only WebSocket tap on a live MultiplayerRoom. URL shape is
// `/observe/{routingKey}/{i}/{j}` — (i) is the room's instance index in the
// registry, (j) is the player's index inside that room. On connect the
// handler replays a catch-up snapshot from `room.getObserverSnapshot`, then
// registers as an observer so subsequent per-player sends also hit this
// socket. The observer can send a `ready` client message to fan out via
// `ctx.fireObserverReady(routingKey)` — used by the scenario-run harness to
// gate scenario start on the recording browser being live.
export class ObserveHandler implements ConnectionHandler {
  async handle(ws: WebSocket, request: IncomingMessage, ctx: ConnectionContext): Promise<void> {
    const params = parseObserverParams(request.url)
    if (!params) {
      ws.close(4004, 'Invalid observer URL')
      return
    }
    const { routingKey, i, j } = params

    const room = ctx.roomRegistry.getRoomByIndex(routingKey, i)
    if (!room) {
      ws.close(4004, 'Room not found')
      return
    }
    const playerId = room.getPlayerIdByIndex(j)
    if (!playerId) {
      ws.close(4004, 'Player not found')
      return
    }

    const snapshot = room.getObserverSnapshot(playerId)
    for (const msg of snapshot) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    }

    room.registerObserver(playerId, ws)
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'ready') ctx.fireObserverReady(routingKey)
      } catch { /* ignore */ }
    })
    ws.on('close', () => room.unregisterObserver(playerId, ws))
  }
}
