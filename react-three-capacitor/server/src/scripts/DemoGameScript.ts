import type {
  GameScript,
  GameScriptContext,
  VoteChangedPayload,
} from '../GameScript.js'

const VOTE_TIMEOUT_MS = 30_000

interface DemoState {
  voted: Record<string, true>
  // Per-player pending-eliminate timer id, so we can cancel when the player
  // votes in time. Stored as data so it survives a dump/restore cycle.
  pendingEliminateByPlayer: Record<string, string>
  voteListenerRegistered: boolean
}

export const demoGameScript: GameScript<DemoState> = {
  initialState: () => ({
    voted: {},
    pendingEliminateByPlayer: {},
    voteListenerRegistered: false,
  }),

  onPlayerConnect(state, ctx, playerId) {
    ctx.toggleVoteRegion('vote_yes', true)
    ctx.toggleVoteRegion('vote_no', true)
    ctx.sendInstruction(playerId, 'vote_instruction')

    const timerId = ctx.after(VOTE_TIMEOUT_MS, 'voteTimeout', playerId)
    state.pendingEliminateByPlayer[playerId] = timerId

    if (!state.voteListenerRegistered) {
      state.voteListenerRegistered = true
      ctx.onVoteChanged(['vote_yes', 'vote_no'], 'voteChanged')
    }
  },

  handlers: {
    voteTimeout(state, ctx, playerId: string) {
      if (state.voted[playerId]) return
      if (!ctx.getPlayerIds().includes(playerId)) return
      state.voted[playerId] = true
      delete state.pendingEliminateByPlayer[playerId]
      ctx.eliminatePlayer(playerId)
    },

    voteChanged(state, ctx, payload: VoteChangedPayload) {
      for (const [playerId, region] of Object.entries(payload.assignments)) {
        if (state.voted[playerId]) continue
        if (region !== 'vote_yes' && region !== 'vote_no') continue
        state.voted[playerId] = true
        const timerId = state.pendingEliminateByPlayer[playerId]
        if (timerId) {
          ctx.cancelAfter(timerId)
          delete state.pendingEliminateByPlayer[playerId]
        }
        if (region === 'vote_no') ctx.eliminatePlayer(playerId)
      }
    },
  },
}
