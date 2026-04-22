import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ScenarioRegistry.js'
import type { GameScript, GameScriptContext } from '../../../react-three-capacitor/server/src/GameScript.js'

const ALL_REGIONS = ['s2_v1', 's2_v2', 's2_v3', 's2_v4']
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
  }
}

export const SCENARIO2_SCENARIO: ScenarioSpec = {
  id: 'scenario2',
  mapId: 'scenario2',
  instructionSpecs: [
    { id: 'join_instruction', text: 'Find your partner', label: 'COMMAND' },
    { id: 'warning_instruction', text: '10 seconds to vote!', label: 'COMMAND' },
  ],
  scriptFactory: () => new Scenario2Script(),
  initialVisibility: {},
}
