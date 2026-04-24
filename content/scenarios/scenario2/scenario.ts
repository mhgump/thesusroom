import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ContentRegistry.js'
import type { GameScript, GameScriptContext } from '../../../react-three-capacitor/server/src/GameScript.js'

const ALL_REGIONS = ['s2_v1', 's2_v2', 's2_v3', 's2_v4']

let _terminateCb: (() => void) | null = null
const WARN_MS = 20_000
const RESOLVE_MS = 10_000
const MAX_PLAYERS = 8

class Scenario2Script implements GameScript {
  private readonly playerOrder: string[] = []

  onPlayerConnect(ctx: GameScriptContext, playerId: string): void {
    this.playerOrder.push(playerId)

    for (const id of ALL_REGIONS) ctx.toggleVoteRegion(id, true)
    ctx.sendInstruction(playerId, 'join_instruction')

    if (ctx.getPlayerIds().length >= MAX_PLAYERS) {
      ctx.closeScenario()
      this.startVoting(ctx)
    }
  }

  private startVoting(ctx: GameScriptContext): void {
    ctx.after(WARN_MS, () => {
      for (const pid of ctx.getPlayerIds()) ctx.sendInstruction(pid, 'warning_instruction')
      ctx.after(RESOLVE_MS, () => this.resolveVotes(ctx))
    })
  }

  private resolveVotes(ctx: GameScriptContext): void {
    const assignments = ctx.getVoteAssignments()
    const living = ctx.getPlayerIds()
    for (let i = 0; i < this.playerOrder.length - 1; i += 2) {
      const a = this.playerOrder[i]
      const b = this.playerOrder[i + 1]
      if (!b || !living.includes(a) || !living.includes(b)) continue
      const ra = assignments.get(a) ?? null
      const rb = assignments.get(b) ?? null
      if (!ra || ra !== rb) {
        ctx.eliminatePlayer(a)
        ctx.eliminatePlayer(b)
      }
    }
    _terminateCb?.()
  }
}

export const SCENARIO: ScenarioSpec = {
  id: 'scenario2',
  timeoutMs: 120_000,
  onTerminate(cb) { _terminateCb = cb },
  scriptFactory: () => new Scenario2Script(),
}
