import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ContentRegistry.js'
import type {
  GameScript,
  GameScriptContext,
  PlayerEnterRoomPayload,
  VoteChangedPayload,
} from '../../../react-three-capacitor/server/src/GameScript.js'
import { FILL_BOT } from '../../bots/scenario1/fill/bot.js'

// Designed around 4-player rooms. MIN_PLAYERS is the bot-fill target.
//
// Lifecycle:
// - First connect schedules the bot fill 5s later.
// - fillBots spawns FILL_BOTs up to MIN_PLAYERS, then schedules a brief
//   settle delay before calling ctx.closeScenario(). The delay is required
//   because ctx.spawnBot() creates fresh WebSocket clients under the hood:
//   if the room is closed before those sockets finish their handshake, the
//   connection dispatcher rejects them with "Handler failure".
// - Bots converge on vote regions; once every region has exactly one
//   occupant, `onVoteChanged` opens each player's main→sub door and starts
//   a 30s "exit the vote room" timer. Anyone still in `main` when the
//   timer fires is eliminated.
// - If everyone crosses into their sub-room before the 30s is up,
//   `onSubRoomEnter` cancels the timer and resolves early — nothing to
//   eliminate, so we skip straight to unlocking the final room.
// - For survivors, the matching sub-room north wall + final south door
//   drop, and players walk into the final room. After a short grace
//   window the scenario terminates.
const MIN_PLAYERS = 4
const BOT_FILL_DELAY_MS = 3_000
const CLOSE_AFTER_FILL_MS = 1_000
const FIND_INSTRUCTION_DELAY_MS = 1_000
const ELIMINATION_DELAY_MS = 8_000
const FINAL_DELAY_MS = 8_000

const ALL_REGIONS = ['s1_v1', 's1_v2', 's1_v3', 's1_v4']
const ALL_WALLS = [
  's1_w1l', 's1_w1r', 's1_w1f',
  's1_w2l', 's1_w2r', 's1_w2f',
  's1_w3l', 's1_w3r', 's1_w3f',
  's1_w4l', 's1_w4r', 's1_w4f',
]
// Per-region geometry, indexed identically to ALL_REGIONS / VOTE_X.
const SUB_DOORS         = ['s1_d1', 's1_d2', 's1_d3', 's1_d4']
const SUB_NORTH_WALLS   = ['s1_p1_n', 's1_p2_n', 's1_p3_n', 's1_p4_n']
const FINAL_SOUTH_DOORS = ['s1_fd1', 's1_fd2', 's1_fd3', 's1_fd4']
const VOTE_X            = [-0.6, -0.2, 0.2, 0.6]
// Anyone with z >= MAIN_NORTH_Z when the timer fires is still in `main` —
// they failed to exit the first vote room and get eliminated.
const MAIN_NORTH_Z = -0.375
// Scoped (map-instance-prefixed) sub-room ids, matching what
// `onPlayerEnterRoom` emits as `payload.roomId`.
const SUB_ROOM_IDS = new Set([
  'scenario1_p1', 'scenario1_p2', 'scenario1_p3', 'scenario1_p4',
])

interface S1State {
  fillScheduled: boolean
  fillDone: boolean
  closed: boolean
  wallsShown: boolean
  eliminated: boolean
  finalized: boolean
  voteListenerRegistered: boolean
  playerSubRoom: Record<string, string>
  elimTimerId: string | null
}

function resolveElimination(state: S1State, ctx: GameScriptContext): void {
  if (state.eliminated) return
  state.eliminated = true
  if (state.elimTimerId) {
    ctx.cancelAfter(state.elimTimerId)
    state.elimTimerId = null
  }

  const survivors: string[] = []
  for (const pid of ctx.getPlayerIds()) {
    const pos = ctx.getPlayerPosition(pid)
    if (!pos || pos.z >= MAIN_NORTH_Z) {
      ctx.eliminatePlayer(pid)
    } else {
      survivors.push(pid)
    }
  }

  ctx.exitBots()

  if (survivors.length === 0) {
    ctx.exitScenario()
    return
  }

  // Drop each survivor's sub-room north wall and matching final south door
  // so they can walk through. Door choice is derived from the player's
  // current x — the sub-room they're standing in. The final room is always
  // visible (no setRoomVisible needed); only the doors kept it sealed off.
  for (const pid of survivors) {
    const pos = ctx.getPlayerPosition(pid)
    if (!pos) continue
    let bestIdx = 0
    let bestD = Math.abs(pos.x - VOTE_X[0])
    for (let i = 1; i < VOTE_X.length; i++) {
      const d = Math.abs(pos.x - VOTE_X[i])
      if (d < bestD) { bestD = d; bestIdx = i }
    }
    ctx.setGeometryVisible(
      [SUB_NORTH_WALLS[bestIdx], FINAL_SOUTH_DOORS[bestIdx]],
      false,
      [pid],
    )
    ctx.sendInstruction(pid, 'final_instruction')
  }

  ctx.after(FINAL_DELAY_MS, 'finalizeRun')
}

const script: GameScript<S1State> = {
  initialState: () => ({
    fillScheduled: false,
    fillDone: false,
    closed: false,
    wallsShown: false,
    eliminated: false,
    finalized: false,
    voteListenerRegistered: false,
    playerSubRoom: {},
    elimTimerId: null,
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
      // Register the room-enter listener up front; `onSubRoomEnter`
      // early-exits until walls are shown, so entries during the vote
      // phase are ignored.
      ctx.onPlayerEnterRoom('onSubRoomEnter')
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
      if (state.fillDone) return
      state.fillDone = true
      const needed = MIN_PLAYERS - ctx.getPlayerIds().length
      for (let i = 0; i < needed; i++) ctx.spawnBot(FILL_BOT)
      ctx.after(CLOSE_AFTER_FILL_MS, 'closeRoom')
    },

    closeRoom(state, ctx) {
      if (state.closed) return
      state.closed = true
      ctx.closeScenario()
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
      // Drop each player's north-wall door so they can step into their
      // 0.5×0.5 sub-room, and tell them they have 30s to do so.
      for (const [pid, regionId] of Object.entries(payload.assignments)) {
        if (!regionId) continue
        const idx = ALL_REGIONS.indexOf(regionId)
        if (idx < 0) continue
        ctx.setGeometryVisible([SUB_DOORS[idx]], false, [pid])
        ctx.sendInstruction(pid, 'subroom_instruction')
      }
      state.elimTimerId = ctx.after(ELIMINATION_DELAY_MS, 'eliminateStragglers')
    },

    // Fires whenever any player crosses into a new room. Once walls are up,
    // this tracks sub-room entries so the scenario can skip straight to the
    // final-room unlock if every alive player made it in before the 30s
    // deadline.
    onSubRoomEnter(state, ctx, payload: PlayerEnterRoomPayload) {
      if (!state.wallsShown || state.eliminated) return
      if (!SUB_ROOM_IDS.has(payload.roomId)) return
      state.playerSubRoom[payload.playerId] = payload.roomId

      const alive = ctx.getPlayerIds()
      if (alive.length === 0) return
      if (!alive.every(pid => state.playerSubRoom[pid])) return

      resolveElimination(state, ctx)
    },

    eliminateStragglers(state, ctx) {
      resolveElimination(state, ctx)
    },

    finalizeRun(state, ctx) {
      if (state.finalized) return
      state.finalized = true
      ctx.exitScenario()
    },
  },
}

export const SCENARIO: ScenarioSpec = {
  id: 'scenario1',
  timeoutMs: 90_000,
  maxPlayers: 4,
  script,
  initialVisibility: Object.fromEntries(ALL_WALLS.map(id => [id, false])),
  hubConnection: {
    mainRoomId: 'main',
    dockGeometryId: 's1_ws',
  },
  exitConnection: {
    roomId: 'final',
    dockGeometryId: 's1_fwne',
  },
}
