import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ContentRegistry.js'
import type { GameScript } from '../../../react-three-capacitor/server/src/GameScript.js'
import { IDLE_BOT } from '../../bots/scenario4/idle/bot.js'

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
// - finalizeRun provides the only terminate path — scenario4 has no
//   gameplay beyond room entry.
const MIN_PLAYERS = 4
const BOT_FILL_DELAY_MS = 3_000
const CLOSE_AFTER_FILL_MS = 1_000
const FINALIZE_AFTER_CLOSE_MS = 2_000
// Holds the scenario open after the bot-exit trigger so bots have time to
// visibly walk off the east edge before the exit-transfer tears the room
// down.
const BOT_EXIT_DELAY_MS = 5_000

interface S4State {
  fillScheduled: boolean
  fillDone: boolean
  closed: boolean
  finalized: boolean
}

const script: GameScript<S4State> = {
  initialState: () => ({
    fillScheduled: false,
    fillDone: false,
    closed: false,
    finalized: false,
  }),

  onPlayerConnect(state, ctx) {
    if (state.fillScheduled) return
    state.fillScheduled = true
    ctx.after(BOT_FILL_DELAY_MS, 'fillBots')
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
      ctx.exitBots()
      ctx.after(BOT_EXIT_DELAY_MS, 'finalExit')
    },

    finalExit(_state, ctx) {
      ctx.exitScenario()
    },
  },
}

export const SCENARIO: ScenarioSpec = {
  id: 'scenario4',
  timeoutMs: 60_000,
  maxPlayers: 4,
  script,
  hubConnection: {
    mainRoomId: 'center',
    dockGeometryId: 's4_c_s',
  },
  // north_hall's north wall is already exactly the hallway width (0.25), so
  // the existing `s4_n_n` segment is the exit dock as-is — no split needed.
  exitConnection: {
    roomId: 'north_hall',
    dockGeometryId: 's4_n_n',
  },
}
