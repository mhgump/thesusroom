import { WebSocketServer, type WebSocket } from 'ws'
import type { Room } from './Room.js'
import { DemoRoom } from './DemoRoom.js'
import type { ClientMessage } from './types.js'

export class GameServer {
  private readonly wss: WebSocketServer
  private readonly rooms: Map<string, Room> = new Map()

  constructor(port: number) {
    this.wss = new WebSocketServer({ port })
    this.rooms.set('demo', new DemoRoom('demo'))
    this.wss.on('connection', this.handleConnection.bind(this))
    console.log(`[GameServer] ws://localhost:${port}`)
  }

  private handleConnection(ws: WebSocket): void {
    const playerId = crypto.randomUUID()
    const room = this.rooms.get('demo')!

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

    ws.on('close', () => room.removePlayer(playerId))
  }
}
