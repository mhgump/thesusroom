import { WebSocketServer, WebSocket } from 'ws'
import type http from 'http'
import type { IncomingMessage } from 'http'
import { ContentRegistry } from './ContentRegistry.js'
import { RoomRouter } from './RoomRouter.js'
import { createDefaultScenarioResolver } from './orchestration/index.js'
import { BotManager } from './bot/BotManager.js'
import { MultiplayerRoom } from './Room.js'
import type { ClientMessage, ServerMessage } from './types.js'
import { PlayerRecordingManager } from './PlayerRecordingManager.js'
import { MAP as INITIAL_MAP } from '../../../assets/initial/map.js'
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

// `/recordings/{index}` — WebSocket endpoint for replay. The saved
// recording is self-sufficient: its `world_reset` event carries the full
// map bundle, so the client no longer needs the routing key in the URL
// to pick a scenario-specific chunk.
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

// Hardcoded first-pass hub target: `/` visitors are routed into scenario2
// via the solo-hallway transfer flow. A future iteration will round-robin
// across any scenario whose spec declares a `hubConnection`.
const HUB_TARGET_ROUTING_KEY = 'r_scenario2'

// Initial hallway's authored spawn — the solo MR seeds the player here and
// the hub transfer translates it into the target MR's world frame.
const INITIAL_HALLWAY_SPAWN_LOCAL = { x: 0, z: 0.5 }

// Monotonic counter for solo hallway MR ids. Each `/` connection gets a
// fresh private MR, so these never collide.
let soloHallwayCounter = 0

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

    if (routingKey === 'hub') {
      await this.handleHubConnection(ws, browserUuid)
      return
    }

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
    this.wireWs(ws, routed.room, routed.playerId)
  }

  // Bind a WebSocket's message handlers to a (room, playerId) pair. The
  // binding is mutable — `rebindWs` (called by the hub transfer flow)
  // updates the captured room/playerId so subsequent client messages route
  // to the new owning MR.
  private readonly wsBindings: Map<WebSocket, { room: MultiplayerRoom; playerId: string }> = new Map()

  private wireWs(ws: WebSocket, room: MultiplayerRoom, playerId: string): void {
    this.wsBindings.set(ws, { room, playerId })
    this.playerRoom.set(playerId, room)

    ws.on('message', (data) => {
      const binding = this.wsBindings.get(ws)
      if (!binding) return
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage
        if (msg.type === 'move') {
          binding.room.handleMove(binding.playerId, msg.tick, msg.inputs)
        } else if (msg.type === 'choice') {
          // handled by game script manager via room if needed
        } else if (msg.type === 'ready') {
          binding.room.handlePlayerReady(binding.playerId)
        } else if (msg.type === 'world_reset_ack') {
          binding.room.handleWorldResetAck(binding.playerId)
        }
      } catch {
        // ignore malformed messages
      }
    })

    ws.on('close', () => {
      const binding = this.wsBindings.get(ws)
      if (!binding) return
      this.wsBindings.delete(ws)
      binding.room.removePlayer(binding.playerId)
      this.playerRoom.delete(binding.playerId)
    })
  }

  // Update the WebSocket's binding to point at a new (room, playerId).
  // Called during hub transfer after the player has been released from
  // their solo MR and seated on the target MR.
  private rebindWs(ws: WebSocket, room: MultiplayerRoom, playerId: string): void {
    const prev = this.wsBindings.get(ws)
    if (prev) this.playerRoom.delete(prev.playerId)
    this.wsBindings.set(ws, { room, playerId })
    this.playerRoom.set(playerId, room)
  }

  // Hub flow: seat the player in a private solo hallway MR immediately
  // (they can move around inside the closed hallway) while we find or
  // create a target MR with an open hub slot. On success, release the
  // player from the solo MR and transfer them into the target MR — the
  // target MR sends its own world_reset with both maps attached and gates
  // the reveal on the client's ack.
  private async handleHubConnection(ws: WebSocket, browserUuid: string | null): Promise<void> {
    const solo = this.createSoloHallwayRoom()
    const soloPlayerId = solo.connectPlayer(ws, browserUuid, 'hub')
    this.wireWs(ws, solo, soloPlayerId)

    // Find or create a target MR with an open hub slot, then transfer the
    // player over. Any failure tears down the solo MR and closes the
    // socket — this is a best-effort attempt; the client can reconnect.
    try {
      const target = await this.router.findOrCreateHubSlot(HUB_TARGET_ROUTING_KEY)
      if (!target) throw new Error(`No hub-capable target for ${HUB_TARGET_ROUTING_KEY}`)
      if (!target.isHubSlotOpen()) throw new Error('Hub slot closed between discovery and transfer')
      if (ws.readyState !== WebSocket.OPEN) {
        // Player dropped while we were resolving; just tear down.
        solo.destroy()
        return
      }
      solo.releasePlayer(soloPlayerId)
      const newPlayerId = target.acceptHubTransfer(ws, browserUuid, 'hub', INITIAL_MAP, INITIAL_HALLWAY_SPAWN_LOCAL)
      this.rebindWs(ws, target, newPlayerId)
      solo.destroy()
    } catch (err) {
      console.error('[GameServer] hub transfer failed:', err)
      // Leave the player in the solo MR; they can at least walk around the
      // hallway. Next time they reconnect we'll try again. Alternative:
      // close the socket with an error code.
    }
  }

  // Build a one-player-scoped MR whose World contains just the initial
  // hallway. The router never sees this MR — it's privately owned by the
  // connection and torn down when the hub transfer completes (or when the
  // player disconnects before transfer, via the ws close handler calling
  // removePlayer + the MR's own tick loop stopping after closed + empty).
  private createSoloHallwayRoom(): MultiplayerRoom {
    soloHallwayCounter++
    const room = new MultiplayerRoom({
      roomId: `solo-hallway-${soloHallwayCounter}`,
      instanceIndex: soloHallwayCounter,
      spawnPosition: INITIAL_HALLWAY_SPAWN_LOCAL,
      recordingManager: this.recordingManager,
      autoDestroyOnEmpty: true,
      // onCloseScenario / onRoomDone are not wired: the solo MR lives
      // outside the router's lifecycle and is torn down explicitly via
      // `destroy()` after transfer (or auto-destroyed when empty if the
      // player disconnects before transfer completes).
    })
    room.addMap(INITIAL_MAP)
    return room
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
