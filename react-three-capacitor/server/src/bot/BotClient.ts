import WebSocket from 'ws'
import type { BotSpec, BotState, BotCallbackContext, BotCommand } from './BotTypes.js'
import { isAtTarget } from './BotTypes.js'

const DEFAULT_TICK_MS = 50
const DEFAULT_RECONNECT_MS = 2000
const DEFAULT_MOVE_REPORT_DISTANCE = 0.5
const DEFAULT_MOVE_REPORT_INTERVAL_MS = 500
const DEFAULT_NEXT_COMMAND_INTERVAL_MS = 250

export interface BotLogEntry {
  time: number
  level: 'info' | 'warn' | 'error'
  message: string
}

export class BotClient {
  private ws: WebSocket | null = null
  private playerId: string | null = null
  private position = { x: 0, z: 0 }
  private state: BotState
  private clientPredictiveTick = 0
  private tickTimer: ReturnType<typeof setTimeout> | null = null
  private lastTickTime = Date.now()
  private running = false
  private readonly _logs: BotLogEntry[] = []
  private readonly tickMs: number
  private readonly moveReportIntervalMs: number
  private readonly nextCommandIntervalMs: number

  private readonly otherPlayers = new Map<string, { x: number; z: number }>()
  private readonly lastReportedPos = new Map<string, { x: number; z: number }>()
  private readonly lastReportedTime = new Map<string, number>()
  private lastNextCommandMs = 0
  private currentCommand: BotCommand = { type: 'idle' }

  private readonly serverUrl: string
  private readonly routingKey: string
  private readonly spec: BotSpec
  private readonly autoReady: boolean

  constructor(serverUrl: string, routingKey: string, spec: BotSpec, options?: { tickMs?: number; autoReady?: boolean }) {
    this.serverUrl = serverUrl
    this.routingKey = routingKey
    this.spec = spec
    this.state = { ...spec.initialState }
    this.tickMs = options?.tickMs ?? DEFAULT_TICK_MS
    this.autoReady = options?.autoReady ?? true
    const speedFactor = DEFAULT_TICK_MS / this.tickMs
    this.moveReportIntervalMs = DEFAULT_MOVE_REPORT_INTERVAL_MS / speedFactor
    this.nextCommandIntervalMs = DEFAULT_NEXT_COMMAND_INTERVAL_MS / speedFactor
  }

  sendReady(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ready' }))
    }
  }

  get logs(): readonly BotLogEntry[] { return this._logs }

  private log(level: BotLogEntry['level'], message: string): void {
    this._logs.push({ time: Date.now(), level, message })
  }

  start(): void {
    this.running = true
    this.log('info', `starting — server: ${this.serverUrl}/${this.routingKey}`)
    this.connect()
  }

  stop(): void {
    this.running = false
    this.stopTick()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.log('info', 'stopped')
  }

  private connect(): void {
    if (!this.running) return
    const ws = new WebSocket(`${this.serverUrl}/${this.routingKey}`)
    this.ws = ws

    ws.on('open', () => {
      this.log('info', 'connected')
      this.clientPredictiveTick = 0
      this.lastTickTime = Date.now()
      this.startTick()
    })

    ws.on('message', (data) => {
      try {
        this.handleMessage(JSON.parse(data.toString()))
      } catch (err) {
        this.log('error', `message parse error: ${err}`)
      }
    })

    ws.on('close', (code, reason) => {
      this.log('info', `disconnected (code=${code} reason=${reason.toString() || '—'})`)
      this.stopTick()
      if (this.running) {
        setTimeout(() => this.connect(), DEFAULT_RECONNECT_MS)
      }
    })

    ws.on('error', (err) => {
      this.log('error', `ws error: ${err.message}`)
    })
  }

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'welcome': {
        this.playerId = msg.playerId as string
        this.position = { x: msg.x as number, z: msg.z as number }
        this.log('info', `welcome as ${this.playerId} at (${this.position.x.toFixed(2)}, ${this.position.z.toFixed(2)})`)
        if (this.autoReady) this.sendReady()
        break
      }

      case 'move_ack': {
        this.position = { x: msg.x as number, z: msg.z as number }
        break
      }

      case 'player_joined': {
        if (!msg.isNpc) {
          const pid = msg.playerId as string
          if (pid === this.playerId) break
          const pos = { x: msg.x as number, z: msg.z as number }
          this.otherPlayers.set(pid, pos)
          this.lastReportedPos.set(pid, { ...pos })
        }
        break
      }

      case 'player_left': {
        const pid = msg.playerId as string
        if (pid === this.playerId) {
          this.log('warn', 'eliminated by server')
          this.stop()
          return
        }
        this.otherPlayers.delete(pid)
        this.lastReportedPos.delete(pid)
        this.lastReportedTime.delete(pid)
        break
      }

      case 'player_update': {
        const pid = msg.playerId as string
        if (!this.otherPlayers.has(pid)) break
        const newPos = { x: msg.x as number, z: msg.z as number }
        this.otherPlayers.set(pid, newPos)

        const lastPos = this.lastReportedPos.get(pid)!
        const lastTime = this.lastReportedTime.get(pid) ?? 0
        const now = Date.now()
        const dist = Math.hypot(newPos.x - lastPos.x, newPos.z - lastPos.z)
        if (dist >= DEFAULT_MOVE_REPORT_DISTANCE && now - lastTime >= this.moveReportIntervalMs) {
          const from = { ...lastPos }
          this.lastReportedPos.set(pid, { ...newPos })
          this.lastReportedTime.set(pid, now)
          const phase = this.state.phase
          const fn = this.spec.onOtherPlayerMove[phase]
          if (fn) fn(this.makeContext(), pid, from, newPos)
        }
        break
      }

      case 'instruction': {
        const lines = msg.lines as Array<{ specId: string }> | undefined
        if (lines) {
          for (const line of lines) {
            const fn = this.spec.onInstructMap[line.specId]
            if (fn) fn(this.makeContext())
          }
        }
        break
      }

      case 'vote_assignment_change': {
        const raw = msg.assignments as Record<string, string[]>
        const assignments = new Map<string, string[]>(Object.entries(raw))
        const phase = this.state.phase
        const fn = this.spec.onActiveVoteAssignmentChange[phase]
        if (fn) fn(this.makeContext(), assignments)
        break
      }

      // game_event support for future choice-based mechanics
      case 'game_event': {
        if (this.spec.onChoice) {
          const eventId = msg.eventId as string
          const options = (msg.options as string[]) ?? []
          const choice = this.spec.onChoice(this.makeContext(), eventId, options)
          if (choice !== null && this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'choice', eventId, optionId: choice }))
          }
        }
        break
      }
    }
  }

  private startTick(): void {
    let next = performance.now() + this.tickMs
    const loop = () => {
      if (!this.running || !this.ws || this.ws.readyState !== 1) return
      this.doTick()
      next += this.tickMs
      const delay = Math.max(0, next - performance.now())
      this.tickTimer = setTimeout(loop, delay)
    }
    this.tickTimer = setTimeout(loop, this.tickMs)
  }

  private doTick(): void {
    if (!this.playerId || !this.ws || this.ws.readyState !== WebSocket.OPEN) return

    const now = Date.now()
    // dt is sim-time per tick (50ms), NOT wall-clock — at accelerated tick rates
    // the wall-clock dt would be 12× too small and the bot would appear frozen
    // in sim space. Each input represents exactly one canonical sim-tick.
    const dt = DEFAULT_TICK_MS / 1000

    const commandCompleted =
      this.currentCommand.type === 'move' &&
      isAtTarget(this.position, this.state.target)

    if (commandCompleted || now - this.lastNextCommandMs >= this.nextCommandIntervalMs) {
      const phase = this.state.phase
      const fn = this.spec.nextCommand[phase]
      try {
        this.currentCommand = fn ? fn(this.makeContext(), { ...this.position }) : { type: 'idle' }
      } catch (err) {
        this.log('error', `nextCommand[${phase}] threw: ${err}`)
        this.currentCommand = { type: 'idle' }
      }
      this.lastNextCommandMs = now
    }

    const jx = this.currentCommand.type === 'move' ? this.currentCommand.jx : 0
    const jz = this.currentCommand.type === 'move' ? this.currentCommand.jz : 0

    this.ws.send(JSON.stringify({ type: 'move', tick: this.clientPredictiveTick, inputs: [{ jx, jz, dt }] }))
    this.clientPredictiveTick++
  }

  private stopTick(): void {
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer)
      this.tickTimer = null
    }
  }

  private makeContext(): BotCallbackContext {
    const self = this
    return {
      get state(): BotState { return self.state },
      updateBotState(updates: Partial<BotState>): void {
        Object.assign(self.state, updates)
      },
      getPosition() {
        return { ...self.position }
      },
      getOtherPlayers() {
        return new Map(self.otherPlayers)
      },
      useAbility(abilityId: string): void {
        if (!self.ws || self.ws.readyState !== WebSocket.OPEN) return
        self.ws.send(JSON.stringify({ type: 'ability_use', abilityId }))
      },
    }
  }
}
