import type { GameScript, GameScriptContext } from '../GameScript.js'

const VOTE_TIMEOUT_MS = 30_000

export class DemoGameScript implements GameScript {
  private readonly voted = new Set<string>()
  private readonly cancelTimers = new Map<string, () => void>()

  onPlayerConnect(ctx: GameScriptContext, playerId: string): void {
    ctx.toggleVoteRegion('vote_yes', true)
    ctx.toggleVoteRegion('vote_no', true)
    ctx.sendInstruction(playerId, 'vote_instruction')

    const cancelTimer = ctx.after(VOTE_TIMEOUT_MS, () => {
      if (this.voted.has(playerId)) return
      if (!ctx.getPlayerIds().includes(playerId)) return
      this.voted.add(playerId)
      this.cancelTimers.delete(playerId)
      ctx.eliminatePlayer(playerId)
    })
    this.cancelTimers.set(playerId, cancelTimer)

    ctx.onVoteChanged(['vote_yes', 'vote_no'], (assignments) => {
      if (this.voted.has(playerId)) return
      const region = assignments.get(playerId)
      if (region !== 'vote_yes' && region !== 'vote_no') return
      this.voted.add(playerId)
      const cancel = this.cancelTimers.get(playerId)
      if (cancel) { cancel(); this.cancelTimers.delete(playerId) }
      if (region === 'vote_no') ctx.eliminatePlayer(playerId)
    })
  }
}
