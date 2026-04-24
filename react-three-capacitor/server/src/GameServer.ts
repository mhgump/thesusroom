import { WebSocketServer, WebSocket } from 'ws'
import type http from 'http'
import type { IncomingMessage } from 'http'
import { ContentRegistry } from './ContentRegistry.js'
import { RoomRouter } from './RoomRouter.js'
import { createDefaultScenarioResolver } from './orchestration/index.js'
import { BotManager } from './bot/BotManager.js'
import type { MultiplayerRoom } from './Room.js'
import type { ClientMessage, ServerMessage } from './types.js'
import { PlayerRecordingManager } from './PlayerRecordingManager.js'
import {
  getDataBackend,
  PlayerRegistry,
  PlayerRecordings,
} from '../../../tools/src/_shared/backends/index.js'

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

// The non-observer URL path is always exactly the routing key, e.g. `/r_scenario1`.
// The empty path (`/` or no path) routes to `hub` — the combined hub world
// that fronts the default target scenario with a solo initial hallway.
function parseRoutingKey(url: string | undefined): string | null {
  if (!url) return 'hub'
  const path = url.split('?')[0]
  const first = path.replace(/^\/+/, '').split('/')[0]
  if (first.length === 0) return 'hub'
  return first
}

// `/recordings/{index}` — serves as the WebSocket endpoint for replay.
// Index is the strictly-incrementing PlayerRegistry index, not the browser
// UUID.
function parseReplayParams(url: string | undefined): { index: number } | null {
  if (!url) return null
  const path = url.split('?')[0]
  const m = path.match(/^\/recordings\/(\d+)$/)
  return m ? { index: parseInt(m[1], 10) } : null
}

// Reads the browser-scoped UUID that identifies which recording (if any)
// this connection belongs to. Prefers the `sr_uid` cookie set by the
// Express/Vite middleware; falls back to a `?uid=<uuid>` query param for
// cross-origin dev setups where the cookie is dropped on the WS upgrade.
// Returns null for connections that never loaded the SPA (bots, raw ws
// clients, test harnesses) — those are never recorded.
function parseSrUid(req: IncomingMessage): string | null {
  const raw = req.headers.cookie
  if (raw) {
    const m = raw.match(/(?:^|;\s*)sr_uid=([0-9a-f-]{36})/)
    if (m) return m[1]
  }
  if (req.url) {
    const q = req.url.split('?')[1]
    if (q) {
      const params = new URLSearchParams(q)
      const uid = params.get('uid')
      if (uid && /^[0-9a-f-]{36}$/.test(uid)) return uid
    }
  }
  return null
}

export class GameServer {
  private readonly wss: WebSocketServer
  private readonly content: ContentRegistry
  private readonly router: RoomRouter
  private readonly playerRoom: Map<string, MultiplayerRoom> = new Map()
  private readonly botManager: BotManager
  private readonly observerReadyListeners: Set<() => void> = new Set()
  private readonly playerRegistry: PlayerRegistry
  private readonly playerRecordings: PlayerRecordings
  private readonly recordingManager: PlayerRecordingManager

  constructor(
    content: ContentRegistry,
    portOrServer: number | http.Server,
    httpServerPort?: number,
    options?: {
      tickRateHz?: number
      autoStartScenario?: boolean
      // Fires when any scenario in any room built by this server invokes
      // `ctx.terminate()`. Production leaves this unset.
      onScenarioTerminate?: (scenarioId: string) => void
    },
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

    const dataBackend = getDataBackend()
    this.playerRegistry = new PlayerRegistry(dataBackend)
    this.playerRecordings = new PlayerRecordings(dataBackend)
    this.recordingManager = new PlayerRecordingManager(this.playerRegistry, this.playerRecordings)

    const resolver = createDefaultScenarioResolver(this.content, (routingKey, spec) => {
      this.botManager.spawnBot(routingKey, spec)
    }, options)
    this.router = new RoomRouter(resolver, this.recordingManager)
    this.wss.on('connection', this.handleConnection.bind(this))
  }

  getRecordings(): PlayerRecordings {
    return this.playerRecordings
  }

  getRegistry(): PlayerRegistry {
    return this.playerRegistry
  }

  getRecordingManager(): PlayerRecordingManager {
    return this.recordingManager
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
    const replayParams = parseReplayParams(request.url)
    if (replayParams) {
      void this.handleReplayConnection(ws, replayParams)
      return
    }

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

    const browserUuid = parseSrUid(request)

    let routed: { room: MultiplayerRoom; playerId: string } | null
    try {
      routed = await this.router.routePlayer(routingKey, ws, browserUuid)
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

  private async handleReplayConnection(ws: WebSocket, { index }: { index: number }): Promise<void> {
    let doc
    try {
      doc = await this.playerRecordings.loadRecording<ServerMessage>(index)
    } catch (err) {
      console.error(`[GameServer] loadRecording(${index}) failed:`, err)
      ws.close(4004, 'Recording load error')
      return
    }
    if (!doc) {
      ws.close(4004, 'Recording not found')
      return
    }

    const timers: ReturnType<typeof setTimeout>[] = []
    let cancelled = false
    ws.on('close', () => {
      cancelled = true
      for (const t of timers) clearTimeout(t)
      timers.length = 0
    })

    const schedule = (delayMs: number, fn: () => void): void => {
      const t = setTimeout(() => {
        if (cancelled) return
        fn()
      }, Math.max(0, delayMs))
      timers.push(t)
    }

    for (const evt of doc.events) {
      schedule(evt.tOffsetMs, () => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(evt.message))
      })
    }

    // Send replay_ended slightly after the last scheduled event so the
    // client gets the last message first. If the recording has no events,
    // end immediately.
    const lastOffset = doc.events.length > 0 ? doc.events[doc.events.length - 1].tOffsetMs : 0
    schedule(lastOffset, () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'replay_ended' } satisfies ServerMessage))
    })
  }
}
