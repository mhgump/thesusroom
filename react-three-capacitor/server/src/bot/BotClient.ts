import WebSocket from 'ws'
import type { BotSpec, BotState, BotCallbackContext, BotAction } from './BotTypes.js'
import { isAtTarget } from './BotTypes.js'

const TICK_MS = 50
const RECONNECT_MS = 2000
const MOVE_REPORT_DISTANCE = 0.5
const MOVE_REPORT_INTERVAL_MS = 500
const NEXT_ACTION_INTERVAL_MS = 250

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
  private tick = 0
  private tickInterval: ReturnType<typeof setInterval> | null = null
  private lastTickTime = Date.now()
  private running = false
  private readonly _logs: BotLogEntry[] = []

  private readonly otherPlayers = new Map<string, { x: number; z: number }>()
  private readonly lastReportedPos = new Map<string, { x: number; z: number }>()
  private readonly lastReportedTime = new Map<string, number>()
  private lastNextActionMs = 0
  private currentAction: BotAction = { type: 'idle' }

  private readonly serverUrl: string
  private readonly scenarioId: string
  private readonly spec: BotSpec

  constructor(serverUrl: string, scenarioId: string, spec: BotSpec) {
    this.serverUrl = serverUrl
    this.scenarioId = scenarioId
    this.spec = spec
    this.state = { ...spec.initialState }
  }

  get logs(): readonly BotLogEntry[] { return this._logs }

  private log(level: BotLogEntry['level'], message: string): void {
    this._logs.push({ time: Date.now(), level, message })
  }

  start(): void {
    this.running = true
    this.log('info', `starting — server: ${this.serverUrl}/${this.scenarioId}`)
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
    const ws = new WebSocket(`${this.serverUrl}/${this.scenarioId}`)
    this.ws = ws

    ws.on('open', () => {
      this.log('info', 'connected')
      this.tick = 0
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
        setTimeout(() => this.connect(), RECONNECT_MS)
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
        if (dist >= MOVE_REPORT_DISTANCE && now - lastTime >= MOVE_REPORT_INTERVAL_MS) {
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
            this.ws.send(JSON.stringify({ type: 'choice_action', eventId, optionId: choice }))
          }
        }
        break
      }
    }
  }

  private startTick(): void {
    this.tickInterval = setInterval(() => {
      if (!this.playerId || !this.ws || this.ws.readyState !== WebSocket.OPEN) return

      const now = Date.now()
      const dt = Math.min((now - this.lastTickTime) / 1000, 0.1)
      this.lastTickTime = now

      const actionCompleted =
        this.currentAction.type === 'move' &&
        isAtTarget(this.position, this.state.target)

      if (actionCompleted || now - this.lastNextActionMs >= NEXT_ACTION_INTERVAL_MS) {
        const phase = this.state.phase
        const fn = this.spec.nextAction[phase]
        try {
          this.currentAction = fn ? fn(this.makeContext(), { ...this.position }) : { type: 'idle' }
        } catch (err) {
          this.log('error', `nextAction[${phase}] threw: ${err}`)
          this.currentAction = { type: 'idle' }
        }
        this.lastNextActionMs = now
      }

      const jx = this.currentAction.type === 'move' ? this.currentAction.jx : 0
      const jz = this.currentAction.type === 'move' ? this.currentAction.jz : 0

      this.ws.send(JSON.stringify({ type: 'move', tick: this.tick, inputs: [{ jx, jz, dt }] }))
      this.tick++
    }, TICK_MS)
  }

  private stopTick(): void {
    if (this.tickInterval !== null) {
      clearInterval(this.tickInterval)
      this.tickInterval = null
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
    }
  }
}
