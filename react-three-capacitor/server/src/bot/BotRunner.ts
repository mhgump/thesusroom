import type { ServerMessage, MoveInput } from '../types.js'
import type { BotSpec, BotState, BotCallbackContext, BotCommand } from './BotTypes.js'
import { isAtTarget } from './BotTypes.js'
import type { BotLogEntry } from './BotClient.js'

const DEFAULT_TICK_MS = 50
const DEFAULT_MOVE_REPORT_DISTANCE = 0.5
const DEFAULT_MOVE_REPORT_INTERVAL_MS = 500
const DEFAULT_NEXT_COMMAND_INTERVAL_MS = 250

// Callbacks the BotRunner invokes to reach the enclosing MultiplayerRoom.
// Keeps BotRunner transport-agnostic — the room wires these to its internal
// methods (no WebSocket, no routing).
export interface BotRunnerHooks {
  sendMove(tick: number, inputs: MoveInput[]): void
  sendReady(): void
  sendChoice(eventId: string, optionId: string): void
  sendAbilityUse(abilityId: string): void
}

export interface BotRunnerOptions {
  tickMs?: number
  autoReady?: boolean
}

// In-process driver for a scenario-spawned bot. Mirrors the state machine of
// `BotClient` but receives server messages via `deliverMessage` and sends
// commands via the injected hooks instead of a WebSocket. Lifecycle is owned
// by the enclosing MultiplayerRoom: the room calls `start()` once the bot
// has been seated, `deliverMessage(...)` for every server-to-bot message,
// and `stop()` when the bot is removed.
export class BotRunner {
  private position = { x: 0, z: 0 }
  private state: BotState
  private clientPredictiveTick = 0
  private tickTimer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private welcomed = false
  private readonly _logs: BotLogEntry[] = []
  private readonly tickMs: number
  private readonly moveReportIntervalMs: number
  private readonly nextCommandIntervalMs: number

  private readonly otherPlayers = new Map<string, { x: number; z: number }>()
  private readonly lastReportedPos = new Map<string, { x: number; z: number }>()
  private readonly lastReportedTime = new Map<string, number>()
  private lastNextCommandMs = 0
  private currentCommand: BotCommand = { type: 'idle' }

  private readonly spec: BotSpec
  private readonly hooks: BotRunnerHooks
  private readonly autoReady: boolean
  private onStop: (() => void) | null = null
  private readonly label: string

  constructor(label: string, spec: BotSpec, hooks: BotRunnerHooks, options?: BotRunnerOptions) {
    this.label = label
    this.spec = spec
    this.hooks = hooks
    this.state = { ...spec.initialState }
    this.tickMs = options?.tickMs ?? DEFAULT_TICK_MS
    this.autoReady = options?.autoReady ?? true
    const speedFactor = DEFAULT_TICK_MS / this.tickMs
    this.moveReportIntervalMs = DEFAULT_MOVE_REPORT_INTERVAL_MS / speedFactor
    this.nextCommandIntervalMs = DEFAULT_NEXT_COMMAND_INTERVAL_MS / speedFactor
  }

  get logs(): readonly BotLogEntry[] { return this._logs }

  // Register a callback to fire if the runner stops itself (e.g. on receiving
  // a `player_left` message for its own player id). The MR uses this to
  // clean up its bookkeeping when the bot self-terminates.
  onStopped(cb: () => void): void {
    this.onStop = cb
  }

  start(): void {
    this.running = true
    this.log('info', `starting — direct in-process (${this.label})`)
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    this.stopTick()
    this.log('info', 'stopped')
  }

  // Receive a server-to-client message. The room calls this in place of a
  // WebSocket `send`. Messages the bot doesn't care about are ignored.
  deliverMessage(msg: ServerMessage): void {
    if (!this.running) return
    switch (msg.type) {
      case 'welcome': {
        this.position = { x: msg.x, z: msg.z }
        this.welcomed = true
        this.log('info', `welcome at (${this.position.x.toFixed(2)}, ${this.position.z.toFixed(2)})`)
        this.clientPredictiveTick = 0
        this.startTick()
        // Defer `ready` by one turn so the MR's spawn path can finish
        // attaching this bot to the scenario before the ready event is
        // processed. On the WS path the network round-trip provides this
        // ordering implicitly; in-process we have to emulate it, otherwise
        // `handlePlayerReady` runs before `attachPlayerToDefault` and the
        // scenario's `onPlayerReady` never sees the bot.
        if (this.autoReady) setImmediate(() => { if (this.running) this.hooks.sendReady() })
        return
      }
      case 'move_ack': {
        this.position = { x: msg.x, z: msg.z }
        return
      }
      case 'player_joined': {
        if (msg.isNpc) return
        const pid = msg.playerId
        const pos = { x: msg.x, z: msg.z }
        this.otherPlayers.set(pid, pos)
        this.lastReportedPos.set(pid, { ...pos })
        return
      }
      case 'player_left': {
        const pid = msg.playerId
        this.otherPlayers.delete(pid)
        this.lastReportedPos.delete(pid)
        this.lastReportedTime.delete(pid)
        return
      }
      case 'player_update': {
        const pid = msg.playerId
        if (!this.otherPlayers.has(pid)) return
        const newPos = { x: msg.x, z: msg.z }
        this.otherPlayers.set(pid, newPos)
        const lastPos = this.lastReportedPos.get(pid)!
        const lastTime = this.lastReportedTime.get(pid) ?? 0
        const now = Date.now()
        const dist = Math.hypot(newPos.x - lastPos.x, newPos.z - lastPos.z)
        if (dist >= DEFAULT_MOVE_REPORT_DISTANCE && now - lastTime >= this.moveReportIntervalMs) {
          const from = { ...lastPos }
          this.lastReportedPos.set(pid, { ...newPos })
          this.lastReportedTime.set(pid, now)
          const fn = this.spec.onOtherPlayerMove[this.state.phase]
          if (fn) {
            try { fn(this.makeContext(), pid, from, newPos) }
            catch (err) { this.log('error', `onOtherPlayerMove[${this.state.phase}] threw: ${err}`) }
          }
        }
        return
      }
      case 'instruction': {
        for (const line of msg.lines) {
          const fn = this.spec.onInstructMap[line.specId]
          if (fn) {
            try { fn(this.makeContext()) }
            catch (err) { this.log('error', `onInstructMap[${line.specId}] threw: ${err}`) }
          }
        }
        return
      }
      case 'vote_assignment_change': {
        const raw = msg.assignments
        const assignments = new Map<string, string[]>(Object.entries(raw))
        const fn = this.spec.onActiveVoteAssignmentChange[this.state.phase]
        if (fn) {
          try { fn(this.makeContext(), assignments) }
          catch (err) { this.log('error', `onActiveVoteAssignmentChange[${this.state.phase}] threw: ${err}`) }
        }
        return
      }
      default:
        // All other message types (world_reset, geometry_state, etc.) are
        // no-ops for bots. The BotSpec has no hook for them.
        return
    }
  }

  // Called by the MR when it is removing this bot (e.g. elimination or
  // room teardown). Stops the tick and fires the onStop callback.
  notifyRemoved(): void {
    if (!this.running) return
    this.log('info', 'removed by room')
    this.stop()
    this.onStop?.()
  }

  private log(level: BotLogEntry['level'], message: string): void {
    this._logs.push({ time: Date.now(), level, message })
  }

  private startTick(): void {
    if (this.tickTimer !== null) return
    let next = performance.now() + this.tickMs
    const loop = (): void => {
      if (!this.running || !this.welcomed) return
      this.doTick()
      next += this.tickMs
      const delay = Math.max(0, next - performance.now())
      this.tickTimer = setTimeout(loop, delay)
    }
    this.tickTimer = setTimeout(loop, this.tickMs)
  }

  private stopTick(): void {
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer)
      this.tickTimer = null
    }
  }

  private doTick(): void {
    const now = Date.now()
    const dt = DEFAULT_TICK_MS / 1000

    const commandCompleted =
      this.currentCommand.type === 'move' &&
      isAtTarget(this.position, this.state.target)

    if (commandCompleted || now - this.lastNextCommandMs >= this.nextCommandIntervalMs) {
      const fn = this.spec.nextCommand[this.state.phase]
      try {
        this.currentCommand = fn ? fn(this.makeContext(), { ...this.position }) : { type: 'idle' }
      } catch (err) {
        this.log('error', `nextCommand[${this.state.phase}] threw: ${err}`)
        this.currentCommand = { type: 'idle' }
      }
      this.lastNextCommandMs = now
    }

    const jx = this.currentCommand.type === 'move' ? this.currentCommand.jx : 0
    const jz = this.currentCommand.type === 'move' ? this.currentCommand.jz : 0

    this.hooks.sendMove(this.clientPredictiveTick, [{ jx, jz, dt }])
    this.clientPredictiveTick++
  }

  private makeContext(): BotCallbackContext {
    const self = this
    return {
      get state(): BotState { return self.state },
      updateBotState(updates: Partial<BotState>): void {
        Object.assign(self.state, updates)
      },
      getPosition() { return { ...self.position } },
      getOtherPlayers() { return new Map(self.otherPlayers) },
      useAbility(abilityId: string): void {
        if (!self.running) return
        self.hooks.sendAbilityUse(abilityId)
      },
    }
  }
}
