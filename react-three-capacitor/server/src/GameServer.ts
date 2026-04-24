import { WebSocketServer, WebSocket } from 'ws'
import type http from 'http'
import type { IncomingMessage } from 'http'
import { ContentRegistry } from './ContentRegistry.js'
import { RoomRouter } from './RoomRouter.js'
import { createDefaultScenarioResolver } from './orchestration/index.js'
import { BotManager } from './bot/BotManager.js'
import type { MultiplayerRoom } from './Room.js'
import type { ClientMessage } from './types.js'

// A `/observe/{key}/{i}/{j}` path: `{key}` is the full routing key (e.g.
// `r_demo`), `{i}` the instance index in the router's per-key all-rooms
// array, `{j}` the per-room player index.
function parseObserverParams(url: string | undefined): { routingKey: string; i: number; j: number } | null {
  if (!url) return null
  const path = url.split('?')[0]
  const match = path.match(/^\/observe\/([^/]+)\/(\d+)\/(\d+)$/)
  if (!match) return null
  return { routingKey: match[1], i: parseInt(match[2], 10), j: parseInt(match[3], 10) }
}

// The non-observer URL path is always exactly the routing key, e.g. `/r_demo`.
// The empty path (`/` or no path) routes to `r_demo` for legacy convenience
// so visiting the server root still drops the player into the demo scenario.
function parseRoutingKey(url: string | undefined): string | null {
  if (!url) return 'r_demo'
  const path = url.split('?')[0]
  const first = path.replace(/^\/+/, '').split('/')[0]
  if (first.length === 0) return 'r_demo'
  return first
}

export class GameServer {
  private readonly wss: WebSocketServer
  private readonly content: ContentRegistry
  private readonly router: RoomRouter
  private readonly playerRoom: Map<string, MultiplayerRoom> = new Map()
  private readonly botManager: BotManager
  private readonly observerReadyListeners: Set<() => void> = new Set()

  constructor(
    content: ContentRegistry,
    portOrServer: number | http.Server,
    httpServerPort?: number,
    options?: { tickRateHz?: number; autoStartScenario?: boolean },
  ) {
    let botServerUrl: string
    if (typeof portOrServer === 'number') {
      this.wss = new WebSocketServer({ port: portOrServer })
      botServerUrl = `ws://localhost:${portOrServer}`
      console.log(`[GameServer] ws://localhost:${portOrServer}`)
    } else {
      this.wss = new WebSocketServer({ server: portOrServer })
      const port = httpServerPort ?? process.env.PORT ?? '8080'
      botServerUrl = `ws://localhost:${port}`
      console.log(`[GameServer] attached to HTTP server, bot url: ${botServerUrl}`)
    }
    this.botManager = new BotManager(botServerUrl)
    this.content = content
    const resolver = createDefaultScenarioResolver(this.content, (routingKey, spec) => {
      this.botManager.spawnBot(routingKey, spec)
    }, options)
    this.router = new RoomRouter(resolver)
    this.wss.on('connection', this.handleConnection.bind(this))
  }

  getRouter(): RoomRouter {
    return this.router
  }

  getBotManager(): BotManager {
    return this.botManager
  }

  onObserverReady(cb: () => void): () => void {
    this.observerReadyListeners.add(cb)
    return () => { this.observerReadyListeners.delete(cb) }
  }

  private async handleConnection(ws: WebSocket, request: IncomingMessage): Promise<void> {
    const observerParams = parseObserverParams(request.url)
    if (observerParams) {
      this.handleObserverConnection(ws, observerParams)
      return
    }

    const routingKey = parseRoutingKey(request.url)
    if (!routingKey) {
      ws.close(4004, 'Invalid routing key')
      return
    }

    let routed: { room: MultiplayerRoom; playerId: string } | null
    try {
      routed = await this.router.routePlayer(routingKey, ws)
    } catch (err) {
      console.error(`[GameServer] routePlayer failed for key=${routingKey}:`, err)
      ws.close(4004, 'Routing failure')
      return
    }
    if (!routed) {
      ws.close(4004, 'Unknown routing key')
      return
    }
    const { room, playerId } = routed
    this.playerRoom.set(playerId, room)

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage
        if (msg.type === 'move') {
          room.handleMove(playerId, msg.tick, msg.inputs)
        } else if (msg.type === 'choice') {
          // handled by game script manager via room if needed
        } else if (msg.type === 'ready') {
          room.handlePlayerReady(playerId)
        }
      } catch {
        // ignore malformed messages
      }
    })

    ws.on('close', () => {
      room.removePlayer(playerId)
      this.playerRoom.delete(playerId)
    })
  }

  private handleObserverConnection(ws: WebSocket, { routingKey, i, j }: { routingKey: string; i: number; j: number }): void {
    const room = this.router.getRoomByIndex(routingKey, i)
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
        if (msg.type === 'ready') {
          for (const cb of this.observerReadyListeners) cb()
        }
      } catch { /* ignore */ }
    })
    ws.on('close', () => room.unregisterObserver(playerId, ws))
  }
}
