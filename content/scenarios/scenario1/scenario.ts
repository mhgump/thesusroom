import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ContentRegistry.js'
import type {
  GameScript,
  GameScriptContext,
  VoteChangedPayload,
} from '../../../react-three-capacitor/server/src/GameScript.js'

const ALL_REGIONS = ['s1_v1', 's1_v2', 's1_v3', 's1_v4']
const ALL_WALLS = [
  's1_w1l', 's1_w1r', 's1_w1f',
  's1_w2l', 's1_w2r', 's1_w2f',
  's1_w3l', 's1_w3r', 's1_w3f',
  's1_w4l', 's1_w4r', 's1_w4f',
]

interface S1State {
  wallsShown: boolean
  voteListenerRegistered: boolean
}

const script: GameScript<S1State> = {
  initialState: () => ({ wallsShown: false, voteListenerRegistered: false }),

  onPlayerConnect(state, ctx, playerId) {
    for (const id of ALL_REGIONS) ctx.toggleVoteRegion(id, true)
    ctx.sendInstruction(playerId, 'find_instruction')

    if (ctx.getPlayerIds().length >= 4) ctx.closeScenario()

    if (!state.voteListenerRegistered) {
      state.voteListenerRegistered = true
      ctx.onVoteChanged(ALL_REGIONS, 'onVoteChanged')
    }
  },

  handlers: {
    onVoteChanged(state, ctx, payload: VoteChangedPayload) {
      if (state.wallsShown) return
      const counts = new Map<string, number>()
      for (const regionId of Object.values(payload.assignments)) {
        if (regionId) counts.set(regionId, (counts.get(regionId) ?? 0) + 1)
      }
      if (!ALL_REGIONS.every(r => counts.get(r) === 1)) return
      state.wallsShown = true
      ctx.setGeometryVisible(ALL_WALLS, true)
      for (const pid of ctx.getPlayerIds()) ctx.sendInstruction(pid, 'vote_instruction')
      ctx.terminate()
    },
  },
}

export const SCENARIO: ScenarioSpec = {
  id: 'scenario1',
  timeoutMs: 300_000,
  script,
  initialVisibility: Object.fromEntries(ALL_WALLS.map(id => [id, false])),
}
