import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ContentRegistry.js'
import type {
  GameScript,
  VoteChangedPayload,
} from '../../../react-three-capacitor/server/src/GameScript.js'
import { IDLE_BOT } from '../../bots/scenario1/idle/bot.js'

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
// - finalizeRun provides a fallback terminate for the idle-fill path — idle
//   bots never converge on the vote, so without it the scenario would hang
//   until timeoutMs.
const MIN_PLAYERS = 4
const BOT_FILL_DELAY_MS = 10_000
const CLOSE_AFTER_FILL_MS = 1_000
const FINALIZE_AFTER_CLOSE_MS = 2_000
// Delay between the player walking into the main room and surfacing the
// initial "find your circle" prompt. Keeps the instruction out of the
// hub-hallway transition window.
const FIND_INSTRUCTION_DELAY_MS = 1_000

const ALL_REGIONS = ['s1_v1', 's1_v2', 's1_v3', 's1_v4']
const ALL_WALLS = [
  's1_w1l', 's1_w1r', 's1_w1f',
  's1_w2l', 's1_w2r', 's1_w2f',
  's1_w3l', 's1_w3r', 's1_w3f',
  's1_w4l', 's1_w4r', 's1_w4f',
]
// Per-region: the toggleable door segment in main's north wall that drops
// for the player assigned to that region so they can step into their
// 0.5×0.5 sub-room (the sub-room itself is hidden from non-occupants by
// the client's isRoomOverlapping gate — no explicit setRoomVisible needed).
// Index aligns with ALL_REGIONS.
const SUB_DOORS = ['s1_d1', 's1_d2', 's1_d3', 's1_d4']

interface S1State {
  fillScheduled: boolean
  fillDone: boolean
  closed: boolean
  wallsShown: boolean
  finalized: boolean
  voteListenerRegistered: boolean
}

const script: GameScript<S1State> = {
  initialState: () => ({
    fillScheduled: false,
    fillDone: false,
    closed: false,
    wallsShown: false,
    finalized: false,
    voteListenerRegistered: false,
  }),

  onPlayerConnect(state, ctx) {
    for (const id of ALL_REGIONS) ctx.toggleVoteRegion(id, true)

    if (!state.fillScheduled) {
      state.fillScheduled = true
      ctx.after(BOT_FILL_DELAY_MS, 'fillBots')
    }

    if (!state.voteListenerRegistered) {
      state.voteListenerRegistered = true
      ctx.onVoteChanged(ALL_REGIONS, 'onVoteChanged')
    }
  },

  onPlayerEnterScenario(_state, ctx, playerId) {
    ctx.after(FIND_INSTRUCTION_DELAY_MS, 'sendFindInstruction', playerId)
  },

  handlers: {
    sendFindInstruction(_state, ctx, playerId: string) {
      ctx.sendInstruction(playerId, 'find_instruction')
    },

    fillBots(state, ctx) {
      if (state.fillDone || state.wallsShown) return
      state.fillDone = true
      const needed = MIN_PLAYERS - ctx.getPlayerIds().length
      for (let i = 0; i < needed; i++) ctx.spawnBot(IDLE_BOT)
      ctx.after(CLOSE_AFTER_FILL_MS, 'closeAndFinalize')
    },

    closeAndFinalize(state, ctx) {
      if (state.closed || state.wallsShown) return
      state.closed = true
      ctx.closeScenario()
      ctx.after(FINALIZE_AFTER_CLOSE_MS, 'finalizeRun')
    },

    finalizeRun(state, ctx) {
      if (state.finalized || state.wallsShown) return
      state.finalized = true
      ctx.terminate()
    },

    onVoteChanged(state, ctx, payload: VoteChangedPayload) {
      if (state.wallsShown) return
      const counts = new Map<string, number>()
      for (const regionId of Object.values(payload.assignments)) {
        if (regionId) counts.set(regionId, (counts.get(regionId) ?? 0) + 1)
      }
      if (!ALL_REGIONS.every(r => counts.get(r) === 1)) return
      state.wallsShown = true
      ctx.setGeometryVisible(ALL_WALLS, true)
      // Each player's assigned region → drop that player's north-wall door
      // so they can step into their 0.5×0.5 sub-room. Sub-rooms overlap
      // each other but the client's isRoomOverlapping gate hides rooms that
      // aren't the viewer's current room, so players never see each other's
      // sub-room geometry.
      for (const [pid, regionId] of Object.entries(payload.assignments)) {
        if (!regionId) continue
        const idx = ALL_REGIONS.indexOf(regionId)
        if (idx < 0) continue
        ctx.setGeometryVisible([SUB_DOORS[idx]], false, [pid])
        ctx.sendInstruction(pid, 'vote_instruction')
      }
      ctx.terminate()
    },
  },
}

export const SCENARIO: ScenarioSpec = {
  id: 'scenario1',
  timeoutMs: 300_000,
  maxPlayers: 4,
  script,
  initialVisibility: Object.fromEntries(ALL_WALLS.map(id => [id, false])),
  hubConnection: {
    mainRoomId: 'main',
    dockGeometryId: 's1_ws',
  },
  exitConnection: {
    roomId: 'main',
    dockGeometryId: 's1_wne',
  },
}
