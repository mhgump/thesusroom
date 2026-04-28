import type {
  GameScript,
  GameScriptContext,
  PlayerEnterRoomPayload,
} from '../../react-three-capacitor/server/src/GameScript.js'
import type { ScenarioConfig } from '../../react-three-capacitor/server/src/Scenario.js'
import type { ScenarioSpec } from '../../react-three-capacitor/server/src/ContentRegistry.js'
import type { ExitMergeArgs } from '../../react-three-capacitor/server/src/orchestration/hubAttachment.js'

// Grace period between "player is inside the current hallway" and the
// `exitScenario()` that swaps in the next MR. Short enough that the loop
// feels continuous; long enough that the client's `world_reset` has time
// to render the new hallway before the next transfer.
const ADVANCE_DELAY_MS = 1_000

// Half-depth of the authored initial hallway's single `hall` room. Used by
// the transferred script to test whether a player's world position sits
// inside the NEW (target) hallway vs. the SOURCE (previous) hallway at
// connect time. Keep in sync with `HALL_D / 2` in `assets/initial/map.ts`.
const HALL_ROOM_HALF_DEPTH = 0.75

const LOOP_SCENARIO_ID = 'initial_loop'

// ── Pristine variant ─────────────────────────────────────────────────────
// Runs in the first /loop MR. The player spawned inside the hallway, so
// the trigger is straightforward: detect a player, wait 1s, fire advance.
//
// Re-arm on empty-fire: if the timer fires when no players are seated
// (e.g. the first connector disconnected mid-countdown), we reset the
// scheduled flag so a subsequent connect re-queues. Without this the room
// would go permanently dormant — the bug you hit originally where /loop
// sometimes never advanced.
interface PristineState {
  advanceScheduled: boolean
  advanceFired: boolean
}

const pristineScript: GameScript<PristineState> = {
  initialState: () => ({
    advanceScheduled: false,
    advanceFired: false,
  }),

  onPlayerConnect(state, ctx) {
    if (state.advanceFired || state.advanceScheduled) return
    state.advanceScheduled = true
    ctx.after(ADVANCE_DELAY_MS, 'advance')
  },

  handlers: {
    advance(state, ctx) {
      state.advanceScheduled = false
      if (state.advanceFired) return
      if (ctx.getPlayerIds().length === 0) return
      state.advanceFired = true
      ctx.exitScenario()
    },
  },
}

export const INITIAL_LOOP_SCENARIO: ScenarioSpec = {
  id: LOOP_SCENARIO_ID,
  timeoutMs: 0,
  maxPlayers: 20,
  script: pristineScript,
  initialVisibility: {},
  initialRoomVisibility: {},
  spawn: { x: 0, z: 0.5 },
  exitConnection: {
    roomId: 'hall',
    dockGeometryId: 'initial_wn',
  },
}

// ── Transferred variant ──────────────────────────────────────────────────
// Runs in every subsequent target MR. Transferred players land INSIDE the
// renamed source (the previous hallway), so advance is NOT scheduled on
// connect — that would fire before players had walked into the new
// hallway, and `LoopOrchestration` would then feed the wrong map in as
// the next iteration's source (the new hallway, where players aren't),
// leaving them outside any room.
//
// Correct trigger: once every living player has crossed into the new
// hallway, schedule advance with the 1s grace. If a new joiner spawns
// directly in the hallway (didn't transfer in), they count as already
// entered — that path also advances, through the same `maybeAdvance`
// check in `onPlayerConnect`.
interface TransferredState {
  listenerRegistered: boolean
  advanceScheduled: boolean
  advanceFired: boolean
  playersInHallway: Record<string, true>
  removedSourceMap: boolean
}

export interface BuildLoopScriptArgs {
  mergeArgs: ExitMergeArgs
  sourceMapInstanceId: string
  sourceScopedRoomIds: string[]
  hallwayScopedRoomId: string
}

export function buildLoopTransferredScript(args: BuildLoopScriptArgs): {
  scenarioId: string
  script: GameScript<TransferredState>
  config: Omit<ScenarioConfig, 'id' | 'script'>
} {
  const { mergeArgs, sourceMapInstanceId, sourceScopedRoomIds, hallwayScopedRoomId } = args

  const maybeAdvance = (state: TransferredState, ctx: GameScriptContext): void => {
    if (state.advanceScheduled || state.advanceFired) return
    const living = ctx.getPlayerIds()
    if (living.length === 0) return
    if (!living.every(pid => state.playersInHallway[pid])) return
    if (!state.removedSourceMap) {
      state.removedSourceMap = true
      ctx.removeMap(sourceMapInstanceId)
    }
    state.advanceScheduled = true
    ctx.after(ADVANCE_DELAY_MS, 'advance')
  }

  const script: GameScript<TransferredState> = {
    initialState: () => ({
      listenerRegistered: false,
      advanceScheduled: false,
      advanceFired: false,
      playersInHallway: {},
      removedSourceMap: false,
    }),

    onPlayerConnect(state, ctx, playerId: string) {
      if (!state.listenerRegistered) {
        state.listenerRegistered = true
        ctx.onPlayerEnterRoom('onEnter')
      }
      // New-joiner detection. Transferred players' world positions sit
      // inside the source floor span (north of the hallway's south face).
      // New joiners spawn SOUTH of that face, inside the current hallway.
      // Hide the previous hallway's rooms for new joiners so they only
      // see the current corridor.
      const pos = ctx.getPlayerPosition(playerId)
      if (pos && !state.removedSourceMap && !state.playersInHallway[playerId]) {
        const hallwaySouthFaceZ = mergeArgs.hallwayOrigin.z + HALL_ROOM_HALF_DEPTH
        if (pos.z < hallwaySouthFaceZ) {
          state.playersInHallway[playerId] = true
          if (sourceScopedRoomIds.length > 0) {
            ctx.setRoomVisible(sourceScopedRoomIds, false, [playerId])
          }
        }
      }
      // A new joiner arriving after all transferred players already
      // entered may itself complete the "all in hallway" condition.
      maybeAdvance(state, ctx)
    },

    handlers: {
      onEnter(state, ctx, payload: PlayerEnterRoomPayload) {
        const { roomId, playerId } = payload
        if (roomId !== hallwayScopedRoomId) return
        if (state.playersInHallway[playerId]) return
        state.playersInHallway[playerId] = true
        // Close BOTH walls behind the player: the source's north-wall dock
        // they came through AND the new hallway's south wall that was
        // dropped per-player during reveal. Raising both per-player
        // restores the enclosed-corridor feel for this player.
        ctx.setGeometryVisible(
          [mergeArgs.sourceWallId, mergeArgs.targetWallId],
          true,
          [playerId],
        )
        maybeAdvance(state, ctx)
      },

      advance(state, ctx) {
        state.advanceScheduled = false
        if (state.advanceFired) return
        if (ctx.getPlayerIds().length === 0) return
        state.advanceFired = true
        ctx.exitScenario()
      },
    },
  }

  return {
    scenarioId: LOOP_SCENARIO_ID,
    script,
    config: {
      instructionSpecs: [],
      voteRegions: [],
      initialVisibility: {},
      initialRoomVisibility: {},
    },
  }
}
