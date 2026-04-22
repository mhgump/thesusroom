import { WebSocketServer, type WebSocket } from 'ws'
import { WorldManager } from './WorldManager.js'
import { DEFAULT_SERVER_WORLD } from './DefaultServerWorld.js'
import type { ClientMessage } from './types.js'

export class GameServer {
  private readonly wss: WebSocketServer
  private readonly worldManager: WorldManager
  private readonly playerWorld: Map<string, string> = new Map()

  constructor(port: number) {
    this.wss = new WebSocketServer({ port })
    this.worldManager = new WorldManager([DEFAULT_SERVER_WORLD])
    this.wss.on('connection', this.handleConnection.bind(this))
    console.log(`[GameServer] ws://localhost:${port}`)
  }

  private handleConnection(ws: WebSocket): void {
    const playerId = crypto.randomUUID()
    const worldId = this.worldManager.assignPlayer(playerId)
    const room = this.worldManager.getRoom(worldId)!
    this.playerWorld.set(playerId, worldId)

    room.addPlayer(playerId, ws)

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage
        if (msg.type === 'move') {
          room.processMove(playerId, msg.seq, msg.jx, msg.jz, msg.dt)
        }
      } catch {
        // ignore malformed messages
      }
    })

    ws.on('close', () => {
      room.removePlayer(playerId)
      this.playerWorld.delete(playerId)
    })
  }
}
