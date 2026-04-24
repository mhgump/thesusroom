import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ContentRegistry.js'
import type { GameScript, GameScriptContext } from '../../../react-three-capacitor/server/src/GameScript.js'

const ALL_REGIONS = ['s1_v1', 's1_v2', 's1_v3', 's1_v4']

let _terminateCb: (() => void) | null = null
const ALL_WALLS = ['s1_w1l', 's1_w1r', 's1_w1f', 's1_w2l', 's1_w2r', 's1_w2f', 's1_w3l', 's1_w3r', 's1_w3f', 's1_w4l', 's1_w4r', 's1_w4f']

class Scenario1Script implements GameScript {
  private wallsShown = false
  private voteListenerRegistered = false

  onPlayerConnect(ctx: GameScriptContext, playerId: string): void {
    for (const id of ALL_REGIONS) ctx.toggleVoteRegion(id, true)
    ctx.sendInstruction(playerId, 'find_instruction')

    if (ctx.getPlayerIds().length >= 4) ctx.closeScenario()

    if (!this.voteListenerRegistered) {
      this.voteListenerRegistered = true
      ctx.onVoteChanged(ALL_REGIONS, (assignments) => {
        if (this.wallsShown) return
        const counts = new Map<string, number>()
        for (const regionId of assignments.values()) {
          if (regionId) counts.set(regionId, (counts.get(regionId) ?? 0) + 1)
        }
        if (!ALL_REGIONS.every(r => counts.get(r) === 1)) return
        this.wallsShown = true
        ctx.setGeometryVisible(ALL_WALLS, true)
        for (const pid of ctx.getPlayerIds()) ctx.sendInstruction(pid, 'vote_instruction')
        _terminateCb?.()
      })
    }
  }
}

export const SCENARIO: ScenarioSpec = {
  id: 'scenario1',
  timeoutMs: 300_000,
  onTerminate(cb) { _terminateCb = cb },
  scriptFactory: () => new Scenario1Script(),
  initialVisibility: Object.fromEntries(ALL_WALLS.map(id => [id, false])),
}
