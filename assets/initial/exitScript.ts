import type {
  GameScript,
  GameScriptContext,
  PlayerEnterRoomPayload,
} from '../../react-three-capacitor/server/src/GameScript.js'
import type { ScenarioConfig } from '../../react-three-capacitor/server/src/Scenario.js'
import type { ExitMergeArgs } from '../../react-three-capacitor/server/src/orchestration/hubAttachment.js'
import type { InstructionEventSpec } from '../../react-three-capacitor/src/game/GameSpec.js'

// Sim-time delays (ms). Tick-driven, matching the canonical 20Hz tick rate.
const WARN_DELAY_MS = 6_000    // 120 ticks
const ELIM_DELAY_MS = 2_000    // 40 ticks

const EXIT_SCENARIO_ID = 'initial_exit'
const RULE_EXIT_SPEC_ID = 'rule_exit'

export interface ExitState {
  listenerRegistered: boolean
  timerArmed: boolean
  warned: boolean
  eliminationFired: boolean
  playersInHallway: Record<string, true>
  removedSourceMap: boolean
  done: boolean
}

export interface BuildExitScriptArgs {
  mergeArgs: ExitMergeArgs
  sourceMapInstanceId: string
  sourceScopedRoomIds: string[]
  hallwayScopedRoomId: string
}

// Factory: build the exit-hallway scenario script + config for one in-flight
// exit transfer. Closes over the (immutable) merge args and source-map ids
// so handler bodies can reference them without stashing in state. Each exit
// transfer gets its own script instance — safe because the closed-over data
// is per-transfer and never mutates.
export function buildExitScript(args: BuildExitScriptArgs): {
  scenarioId: string
  script: GameScript<ExitState>
  config: Omit<ScenarioConfig, 'id' | 'script'>
} {
  const { mergeArgs, sourceMapInstanceId, hallwayScopedRoomId } = args
  void args.sourceScopedRoomIds  // reserved for parity with loop variant; not used here yet

  const checkAllEntered = (state: ExitState, ctx: GameScriptContext): void => {
    if (state.done) return
    const living = ctx.getPlayerIds()
    if (living.length === 0) return
    if (!living.every(pid => state.playersInHallway[pid])) return
    state.done = true
    if (!state.removedSourceMap) {
      state.removedSourceMap = true
      ctx.removeMap(sourceMapInstanceId)
    }
    ctx.terminate()
  }

  const script: GameScript<ExitState> = {
    initialState: () => ({
      listenerRegistered: false,
      timerArmed: false,
      warned: false,
      eliminationFired: false,
      playersInHallway: {},
      removedSourceMap: false,
      done: false,
    }),

    onPlayerConnect(state, ctx) {
      if (!state.listenerRegistered) {
        state.listenerRegistered = true
        ctx.onPlayerEnterRoom('onEnter')
      }
      if (!state.timerArmed) {
        state.timerArmed = true
        ctx.after(WARN_DELAY_MS, 'warnMove')
      }
    },

    handlers: {
      onEnter(state, ctx, payload: PlayerEnterRoomPayload) {
        const { roomId, playerId } = payload
        if (roomId !== hallwayScopedRoomId) return
        if (state.playersInHallway[playerId]) return
        state.playersInHallway[playerId] = true
        // Close BOTH walls behind this player — the source-side exit dock
        // they came through AND the hallway's own south wall which was
        // dropped per-player for their reveal. Raising both back to `solid`
        // (per-player) means the hallway reads as a fully enclosed
        // corridor from their view, with no visible gap at the south face.
        ctx.setGeometryVisible(
          [mergeArgs.sourceWallId, mergeArgs.targetWallId],
          true,
          [playerId],
        )
        checkAllEntered(state, ctx)
      },

      warnMove(state, ctx) {
        if (state.warned) return
        state.warned = true
        for (const pid of ctx.getPlayerIds()) {
          if (!state.playersInHallway[pid]) ctx.sendInstruction(pid, RULE_EXIT_SPEC_ID)
        }
        ctx.after(ELIM_DELAY_MS, 'eliminateStragglers')
      },

      eliminateStragglers(state, ctx) {
        if (state.eliminationFired) return
        state.eliminationFired = true
        for (const pid of ctx.getPlayerIds()) {
          if (!state.playersInHallway[pid]) ctx.eliminatePlayer(pid)
        }
        checkAllEntered(state, ctx)
      },
    },
  }

  const instructionSpecs: InstructionEventSpec[] = [
    { id: RULE_EXIT_SPEC_ID, text: 'Players that do not continue will be eliminated.', label: 'RULE' },
  ]

  return {
    scenarioId: EXIT_SCENARIO_ID,
    script,
    config: {
      instructionSpecs,
      voteRegions: [],
      initialVisibility: {},
      initialRoomVisibility: {},
    },
  }
}
