import type WebSocket from 'ws'
import type { IncomingMessage } from 'http'
import type { BotSpec } from '../bot/BotTypes.js'
import type { MultiplayerRoom } from '../Room.js'
import type { RegisteredRun, ScenarioRunRegistry } from '../scenarioRun/ScenarioRunRegistry.js'
import type { RoomCreationContext, RoomOrchestration } from './RoomOrchestration.js'
import type { ConnectionContext } from '../connections/types.js'
import { createScenarioRoom } from './scenarioRoom.js'
import { parseRoutingKey, parseSrUid } from '../connections/urls.js'

// One-shot orchestration that backs a `scenariorun/<runId>` routing key. The registry
// hands it the `RegisteredRun` the resolver just looked up; this class owns
// the lifecycle: build the room via `createScenarioRoom`, start the timeout,
// resolve the result on scenario-terminate or timeout, and refuse to be
// reopened after that (so a second connect for the same key returns null
// upstream).
export class ScenarioRunOrchestration implements RoomOrchestration {
  private roomBuilt = false

  constructor(
    private readonly run: RegisteredRun,
    private readonly registry: ScenarioRunRegistry,
    private readonly spawnBotFn: (routingKey: string, spec: BotSpec) => void,
  ) {}

  async handle(ws: WebSocket, request: IncomingMessage, ctx: ConnectionContext): Promise<void> {
    const routingKey = parseRoutingKey(request.url)
    if (!routingKey) {
      ws.close(4004, 'Invalid routing key')
      return
    }
    const browserUuid = parseSrUid(request)
    const room = ctx.roomRegistry.getOrCreateOpenRoom(routingKey, this)
    const playerId = room.connectPlayer(ws, browserUuid, routingKey)
    ctx.wireWs(ws, room, playerId)
  }

  createRoom(ctx: RoomCreationContext): MultiplayerRoom {
    if (this.roomBuilt) {
      throw new Error(`ScenarioRunOrchestration(${this.run.routingKey}) is one-shot; createRoom already called`)
    }
    this.roomBuilt = true

    const { request, entry } = this.run
    const recording = request.record_bot_index !== null

    const room = createScenarioRoom({
      ctx,
      map: entry.map,
      scenario: entry.scenario,
      spawnBotFn: this.spawnBotFn,
      autoStart: !recording,
      tickRateHz: request.tick_rate_hz,
      onScenarioTerminate: () => {
        this.registry.finalize(this.run, 'scenario', 0)
      },
    })
    this.run.room = room

    // Delayed-start mode: queue `startScenario` for the observer-ready event
    // so buffered player connects/readies only fire once the recorder is
    // actually capturing. Fall back to start-anyway after a short wait so a
    // missing observer doesn't deadlock the run.
    if (recording) {
      const OBSERVER_READY_FALLBACK_MS = 10_000
      let started = false
      const start = (): void => {
        if (started) return
        started = true
        room.startScenario(entry.scenario.id)
      }
      this.run.observerReadyWaiters.push(start)
      const fallback = setTimeout(start, OBSERVER_READY_FALLBACK_MS)
      const prevCleanup = this.run.onCleanup
      this.run.onCleanup = () => { clearTimeout(fallback); prevCleanup?.() }
    }

    const timer = setTimeout(() => {
      this.registry.finalize(this.run, 'timeout', 0)
    }, this.run.effectiveTimeoutMs)
    const prevCleanup = this.run.onCleanup
    this.run.onCleanup = () => { clearTimeout(timer); prevCleanup?.() }

    return room
  }

  // Block a second room from ever being created for this routing key: once
  // the run terminates the router drops the orchestration entry, so new
  // `/scenariorun/<id>` connections are rejected with 4004.
  isOpen(room: MultiplayerRoom): boolean {
    return !this.run.terminated && room.isOpen()
  }
}
