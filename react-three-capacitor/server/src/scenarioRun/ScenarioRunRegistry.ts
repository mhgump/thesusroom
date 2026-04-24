import crypto from 'node:crypto'
import type { ContentEntry, ContentRegistry } from '../ContentRegistry.js'
import type { BotManager } from '../bot/BotManager.js'
import type { MultiplayerRoom } from '../Room.js'
import type { LogEntry } from '../../scripts/logFormat.js'
import type { ScenarioRunRegistered, ScenarioRunRequest, ScenarioRunServerResult } from './types.js'
import { installConsoleTee, currentSeq, sliceByRange } from './consoleTee.js'

export interface RegisteredRun {
  runId: string
  routingRunId: string
  routingKey: string
  request: ScenarioRunRequest
  entry: ContentEntry
  effectiveTimeoutMs: number
  // Registered when the room is built so the orchestration / observer wiring
  // can look up which run "owns" a routing key.
  observerReadyFired: boolean
  observerReadyWaiters: Array<() => void>
  fireObserverReady: () => void
  // The one-shot result. Resolves exactly once on termination or timeout.
  resultPromise: Promise<ScenarioRunServerResult>
  resolveResult: (r: ScenarioRunServerResult) => void
  serverLogsStartSeq: number
  terminated: boolean
  // Populated by the orchestration after `createRoom`. Used by `finalize` to
  // stop the tick loop once the scenario ends or times out.
  room: MultiplayerRoom | null
  // Invoked by the orchestration when it tears down its timer.
  onCleanup: (() => void) | null
}

export class ScenarioRunRegistry {
  private readonly runs = new Map<string, RegisteredRun>()
  private readonly botManager: BotManager
  private readonly content: ContentRegistry

  constructor(content: ContentRegistry, botManager: BotManager) {
    this.content = content
    this.botManager = botManager
    installConsoleTee()
  }

  async register(req: ScenarioRunRequest): Promise<ScenarioRunRegistered> {
    const entry = await this.content.get(req.scenario_id)
    if (!entry) throw new Error(`Unknown scenario: ${req.scenario_id}`)

    const routingRunId = crypto.randomBytes(6).toString('hex')
    const routingKey = `scenariorun/${routingRunId}`
    const simTimeoutMs = req.timeout_ms ?? entry.scenario.timeoutMs
    const speedMultiplier = req.tick_rate_hz / 20
    const effectiveTimeoutMs = simTimeoutMs / speedMultiplier

    let resolveResult!: (r: ScenarioRunServerResult) => void
    const resultPromise = new Promise<ScenarioRunServerResult>(resolve => { resolveResult = resolve })

    const run: RegisteredRun = {
      runId: req.run_id,
      routingRunId,
      routingKey,
      request: req,
      entry,
      effectiveTimeoutMs,
      observerReadyFired: false,
      observerReadyWaiters: [],
      fireObserverReady: () => {
        if (run.observerReadyFired) return
        run.observerReadyFired = true
        const cbs = run.observerReadyWaiters.splice(0)
        for (const cb of cbs) {
          try { cb() } catch (err) { console.error('[ScenarioRunRegistry] observer-ready callback threw:', err) }
        }
      },
      resultPromise,
      resolveResult,
      serverLogsStartSeq: currentSeq(),
      terminated: false,
      room: null,
      onCleanup: null,
    }
    this.runs.set(routingRunId, run)

    return { run_id: req.run_id, routing_key: routingKey, routing_run_id: routingRunId, effective_timeout_ms: effectiveTimeoutMs }
  }

  getByRoutingKey(routingKey: string): RegisteredRun | null {
    const prefix = 'scenariorun/'
    if (!routingKey.startsWith(prefix)) return null
    return this.runs.get(routingKey.slice(prefix.length)) ?? null
  }

  get(routingRunId: string): RegisteredRun | null {
    return this.runs.get(routingRunId) ?? null
  }

  // Mark the run as finished. Collects scenario-spawned bot logs + the slice
  // of server console logs captured during this run, then resolves any
  // long-poll waiters. Subsequent calls are no-ops.
  finalize(
    run: RegisteredRun,
    terminatedBy: 'scenario' | 'timeout',
    exitCode: number,
  ): void {
    if (run.terminated) return
    run.terminated = true

    // Snapshot final state BEFORE destroy() tears the room down. Players still
    // attached when the run ends are the survivors; eliminated / disconnected
    // players have already been removed from `room.players`.
    const survivorIds = run.room?.getLivingPlayerIds() ?? []

    // Scenario-spawned bots now run in-process in the room itself (no
    // WebSocket routing, no BotManager). Pull their accumulated logs from
    // the room so the test artifact still surfaces scenario-bot output.
    const scenarioBotLogs: LogEntry[] = (run.room?.collectBotLogs() ?? []).map(e => ({
      time: e.log.time,
      level: e.log.level,
      source: 'scenario-bot' as const,
      bot_index: e.botIndex,
      message: e.log.message,
    }))
    const serverLogs = sliceByRange(run.serverLogsStartSeq, currentSeq())

    const result: ScenarioRunServerResult = {
      run_id: run.runId,
      termination_metadata: {
        terminated_by: terminatedBy,
        exit_code: exitCode,
        observer_ready_fired: run.observerReadyFired,
        final_state: {
          survivor_count: survivorIds.length,
          survivor_player_ids: survivorIds,
        },
      },
      effective_timeout_ms: run.effectiveTimeoutMs,
      scenario_bot_logs: scenarioBotLogs,
      server_logs: serverLogs,
    }

    run.onCleanup?.()
    run.onCleanup = null
    // Stop the tick loop and destroy scenario state. The room stays
    // referenced until the last WS disconnects, but closed=true blocks the
    // router from handing it to any late connect.
    run.room?.destroy()
    // Stop scenario-spawned bots so they don't keep ticking after the room
    // tears down. CLI-owned bots disconnect themselves.
    this.botManager.stopForKey(run.routingKey)
    run.resolveResult(result)
  }

  // Long-poll a finalized result. Resolves when the run terminates (which
  // invokes `finalize`) or after `maxWaitMs` via a timeout sentinel — the
  // caller decides whether that is a retryable 202 or an error.
  async awaitResult(routingRunId: string, maxWaitMs: number): Promise<ScenarioRunServerResult | 'pending'> {
    const run = this.runs.get(routingRunId)
    if (!run) throw new Error(`Unknown run: ${routingRunId}`)
    let timer: ReturnType<typeof setTimeout> | null = null
    const pending = new Promise<'pending'>(resolve => { timer = setTimeout(() => resolve('pending'), maxWaitMs) })
    const result = await Promise.race([run.resultPromise, pending])
    if (timer) clearTimeout(timer)
    return result
  }

  // Remove a finalized run from the registry. Callers invoke this after they
  // have read the result so the entry doesn't leak.
  dispose(routingRunId: string): void {
    this.runs.delete(routingRunId)
  }
}
