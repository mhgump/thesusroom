import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ContentRegistry.js'
import type {
  GameScript,
  VoteChangedPayload,
} from '../../../react-three-capacitor/server/src/GameScript.js'
import { IDLE_BOT } from '../../bots/scenario3/idle/bot.js'

// Designed around 4-player rooms. MIN_PLAYERS is the bot-fill target.
//
// Close-and-fill lifecycle:
// - First connect schedules the bot fill 10s later.
// - fillBots spawns IDLE_BOTs up to MIN_PLAYERS, then schedules a brief
//   settle delay before calling ctx.closeScenario(). The delay is required
//   because ctx.spawnBot() creates fresh WebSocket clients under the hood:
//   if the room is closed before those sockets finish their handshake, the
//   connection dispatcher rejects them with "Handler failure". Once close
//   fires, it is never called again.
// - finalizeRun provides a fallback terminate — scenario3's button/vote
//   gameplay never calls ctx.terminate() on its own.
const MIN_PLAYERS = 4
const BOT_FILL_DELAY_MS = 3_000
const CLOSE_AFTER_FILL_MS = 1_000
const FINALIZE_AFTER_CLOSE_MS = 2_000

interface S3State {
  fillScheduled: boolean
  fillDone: boolean
  closed: boolean
  finalized: boolean
  listenersRegistered: boolean
}

const script: GameScript<S3State> = {
  initialState: () => ({
    fillScheduled: false,
    fillDone: false,
    closed: false,
    finalized: false,
    listenersRegistered: false,
  }),

  onPlayerConnect(state, ctx) {
    ctx.toggleVoteRegion('s3_rzone', true)

    if (!state.fillScheduled) {
      state.fillScheduled = true
      ctx.after(BOT_FILL_DELAY_MS, 'fillBots')
    }

    if (state.listenersRegistered) return
    state.listenersRegistered = true

    ctx.onButtonPress('btn_left', 'onLeftPress')
    ctx.onButtonPress('btn_right', 'onRightPress')
    ctx.onVoteChanged(['s3_rzone'], 'onVoteChanged')
  },

  handlers: {
    fillBots(state, ctx) {
      if (state.fillDone) return
      state.fillDone = true
      const needed = MIN_PLAYERS - ctx.getPlayerIds().length
      for (let i = 0; i < needed; i++) ctx.spawnBot(IDLE_BOT)
      ctx.after(CLOSE_AFTER_FILL_MS, 'closeAndFinalize')
    },

    closeAndFinalize(state, ctx) {
      if (state.closed) return
      state.closed = true
      ctx.closeScenario()
      ctx.after(FINALIZE_AFTER_CLOSE_MS, 'finalizeRun')
    },

    finalizeRun(state, ctx) {
      if (state.finalized) return
      state.finalized = true
      ctx.exitScenario()
    },

    onLeftPress(_state, ctx) {
      ctx.sendNotification('Left pressed')
    },

    onRightPress(_state, ctx) {
      ctx.sendNotification('Right pressed')
    },

    onVoteChanged(_state, ctx, payload: VoteChangedPayload) {
      const count = Object.values(payload.assignments).filter(r => r === 's3_rzone').length
      if (count === 1) {
        ctx.modifyButton('btn_right', { enableClientPress: true })
      } else {
        ctx.modifyButton('btn_right', { enableClientPress: false })
      }
    },
  },
}

export const SCENARIO: ScenarioSpec = {
  id: 'scenario3',
  timeoutMs: 60_000,
  maxPlayers: 4,
  script,
  hubConnection: {
    mainRoomId: 'main',
    dockGeometryId: 's3_ws',
  },
  exitConnection: {
    roomId: 'main',
    dockGeometryId: 's3_wne',
  },
}
