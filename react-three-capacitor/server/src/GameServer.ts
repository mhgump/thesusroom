import { WebSocketServer, WebSocket } from 'ws'
import type http from 'http'
import type { IncomingMessage } from 'http'
import { ContentRegistry } from './ContentRegistry.js'
import { MultiplayerRoomRegistry } from './MultiplayerRoomRegistry.js'
import { createDefaultScenarioResolver } from './orchestration/index.js'
import { BotManager } from './bot/BotManager.js'
import type { BotSpec } from './bot/BotTypes.js'
import { MultiplayerRoom } from './Room.js'
import { ScenarioRunRegistry } from './scenarioRun/ScenarioRunRegistry.js'
import type { ClientMessage } from './types.js'
import { PlayerRecordingManager } from './PlayerRecordingManager.js'
import {
  getDataBackend,
  PlayerRegistry,
  PlayerRecordings,
} from '../../../tools/src/_shared/backends/index.js'
import { ConnectionDispatcher } from './connections/ConnectionDispatcher.js'
import { ObserveHandler } from './connections/ObserveHandler.js'
import { ReplayHandler } from './connections/ReplayHandler.js'
import type { ConnectionContext } from './connections/types.js'
import { executeExitTransfer } from './orchestration/exitTransfer.js'
import { LoopOrchestration } from './orchestration/LoopOrchestration.js'
import type { GameMap } from '../../src/game/GameMap.js'
import type { ScenarioSpec } from './ContentRegistry.js'

export class GameServer {
  private readonly wss: WebSocketServer
  private readonly content: ContentRegistry
  private readonly roomRegistry: MultiplayerRoomRegistry
  private readonly dispatcher: ConnectionDispatcher
  private readonly playerRoom: Map<string, MultiplayerRoom> = new Map()
  private readonly botManager: BotManager
  private readonly observerReadyListeners: Map<string, Set<() => void>> = new Map()
  private readonly playerRegistry: PlayerRegistry
  private readonly playerRecordings: PlayerRecordings
  private readonly recordingManager: PlayerRecordingManager
  private readonly scenarioRunRegistry: ScenarioRunRegistry

  // Bind a WebSocket's message handlers to a (room, playerId) pair. The
  // binding is mutable — `rebindWs` (called by the hub transfer flow)
  // updates the captured room/playerId so subsequent client messages route
  // to the new owning MR.
  private readonly wsBindings: Map<WebSocket, { room: MultiplayerRoom; playerId: string }> = new Map()

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

    this.scenarioRunRegistry = new ScenarioRunRegistry(this.content, this.botManager)

    const onExitScenario = (sourceRoom: MultiplayerRoom, sourceMap: GameMap, sourceScenario: ScenarioSpec) => {
      try {
        executeExitTransfer({
          sourceRoom,
          sourceMap,
          sourceScenario,
          rebindWs: (ws, room, playerId) => this.rebindWs(ws, room, playerId),
          recordingManager: this.recordingManager,
          // Scenario-spawned bots now run in-process in the MR that owns
          // them; the routing-key spawn path is retained here only for
          // any future exit-hallway scripts that legitimately need a bot
          // reached over the public WebSocket routing.
          spawnBotFn: (routingKey, spec) => this.botManager.spawnBot(routingKey, spec),
        })
      } catch (err) {
        console.error('[GameServer] exit transfer failed:', err)
      }
    }
    const loopOrchestration = new LoopOrchestration(
      {
        spawnBotFn: (routingKey, spec) => this.botManager.spawnBot(routingKey, spec),
        recordingManager: this.recordingManager,
      },
      (ws, room, playerId) => this.rebindWs(ws, room, playerId),
    )
    const resolver = createDefaultScenarioResolver(this.content, this.scenarioRunRegistry, options, onExitScenario, loopOrchestration)
    this.roomRegistry = new MultiplayerRoomRegistry(this.recordingManager)
    this.dispatcher = new ConnectionDispatcher(
      resolver,
      new ObserveHandler(),
      new ReplayHandler(),
      () => this.buildCtx(),
    )
    this.wss.on('connection', this.handleConnection.bind(this))
  }

  getScenarioRunRegistry(): ScenarioRunRegistry {
    return this.scenarioRunRegistry
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

  getRoomRegistry(): MultiplayerRoomRegistry {
    return this.roomRegistry
  }

  getDispatcher(): ConnectionDispatcher {
    return this.dispatcher
  }

  getBotManager(): BotManager {
    return this.botManager
  }

  // Per-routing-key observer-ready subscription. Callback fires when any
  // observer connection for `routingKey` emits a `ready` client message.
  // Scenario-runs use this to delay scenario start until the recording
  // browser is ready; concurrent runs don't cross-fire because the key
  // uniquely identifies the run.
  onObserverReady(routingKey: string, cb: () => void): () => void {
    let set = this.observerReadyListeners.get(routingKey)
    if (!set) { set = new Set(); this.observerReadyListeners.set(routingKey, set) }
    set.add(cb)
    return () => {
      const cur = this.observerReadyListeners.get(routingKey)
      if (!cur) return
      cur.delete(cb)
      if (cur.size === 0) this.observerReadyListeners.delete(routingKey)
    }
  }

  // Fires both the per-key observer-ready listeners and the scenario-run
  // registry's one-shot flag. Invoked by `ObserveHandler` through the
  // `ConnectionContext` when an observer ws sends a `ready` client message.
  private fireObserverReady(routingKey: string): void {
    const listeners = this.observerReadyListeners.get(routingKey)
    if (listeners) for (const cb of listeners) cb()
    const run = this.scenarioRunRegistry.getByRoutingKey(routingKey)
    if (run && !run.observerReadyFired) run.fireObserverReady()
  }

  private buildCtx(): ConnectionContext {
    return {
      roomRegistry: this.roomRegistry,
      recordingManager: this.recordingManager,
      playerRecordings: this.playerRecordings,
      scenarioRunRegistry: this.scenarioRunRegistry,
      wireWs: (ws, room, playerId) => this.wireWs(ws, room, playerId),
      rebindWs: (ws, room, playerId) => this.rebindWs(ws, room, playerId),
      resolveRoomOrchestration: (key) => this.dispatcher.resolveRoomOrchestration(key),
      fireObserverReady: (key) => this.fireObserverReady(key),
    }
  }

  private async handleConnection(ws: WebSocket, request: IncomingMessage): Promise<void> {
    await this.dispatcher.dispatch(ws, request)
  }

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
}
