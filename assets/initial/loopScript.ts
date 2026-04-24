import type {
  GameScript,
  GameScriptContext,
  PlayerEnterRoomPayload,
} from '../../react-three-capacitor/server/src/GameScript.js'
import type { ScenarioConfig } from '../../react-three-capacitor/server/src/Scenario.js'
import type { ScenarioSpec } from '../../react-three-capacitor/server/src/ContentRegistry.js'
import type { ExitAttachment } from '../../react-three-capacitor/server/src/orchestration/hubAttachment.js'
import type { InstructionEventSpec } from '../../react-three-capacitor/src/game/GameSpec.js'

// Sim-time delays for the /loop flow.
// - ADVANCE_MS: how long the current global hallway stays before it advances.
// - ENTER_GRACE_MS: after everyone has entered the new hallway AND the
//   previous one has been removed, wait this long before kicking off the
//   next advance. Gives players a beat in a "single" hallway between
//   transfers, so it actually reads as moving forward rather than a strobe.
// - WARN_DELAY_MS / ELIM_DELAY_MS: pre-advance warning and elimination
//   windows, mirroring the one-shot exit flow.
const ADVANCE_MS       = 12_000
const ENTER_GRACE_MS   = 4_000
const WARN_DELAY_MS    = 8_000
const ELIM_DELAY_MS    = 2_500

const LOOP_SCENARIO_ID = 'initial_loop'
const RULE_EXIT_SPEC_ID = 'rule_loop_exit'

const RULE_EXIT_INSTRUCTION: InstructionEventSpec = {
  id: RULE_EXIT_SPEC_ID,
  text: 'Continue forward or be eliminated.',
  label: 'RULE',
}

// ── Pristine variant ─────────────────────────────────────────────────────
// Runs in the FIRST /loop hallway MR. No previous hallway to clean up, so
// the script just counts down to an exitScenario call. When the 10s warn /
// elim window fires, any straggler hanging around is eliminated before the
// transfer (mirrors the one-shot exit policy).
interface PristineState {
  armed: boolean
  warned: boolean
  eliminationFired: boolean
  advanceFired: boolean
}

const pristineScript: GameScript<PristineState> = {
  initialState: () => ({
    armed: false,
    warned: false,
    eliminationFired: false,
    advanceFired: false,
  }),

  onPlayerConnect(state, ctx) {
    if (state.armed) return
    state.armed = true
    ctx.after(ADVANCE_MS, 'warn')
  },

  handlers: {
    warn(state, ctx) {
      if (state.warned) return
      state.warned = true
      // Everyone in the pristine hallway should advance; no source to stay
      // in. The rule is per-player so rejoiners that arrive post-warn still
      // see it when they attach.
      for (const pid of ctx.getPlayerIds()) ctx.sendInstruction(pid, RULE_EXIT_SPEC_ID)
      ctx.after(ELIM_DELAY_MS, 'elim')
    },

    elim(state, ctx) {
      if (state.eliminationFired) return
      state.eliminationFired = true
      // No "in-hallway" distinction here; everyone survives unless the
      // scenario is reworked to allow AFK detection. Fire the advance.
      if (state.advanceFired) return
      state.advanceFired = true
      if (ctx.getPlayerIds().length === 0) return
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

export function getInitialLoopInstructionSpecs(): InstructionEventSpec[] {
  return [RULE_EXIT_INSTRUCTION]
}

// ── Transferred variant ──────────────────────────────────────────────────
// Runs in every subsequent target MR (each new hallway that replaces the
// previous global instance). Combines the one-shot exit behavior (per-
// player door close on enter, source-map removal when all settled) with a
// re-arm: once the source map has been removed, schedules the next
// exitScenario fire so the loop advances. Closure-bound to attachment +
// renamed source map instance id produced by `executeExitTransfer`.
interface TransferredState {
  listenerRegistered: boolean
  warnScheduled: boolean
  warned: boolean
  eliminationFired: boolean
  playersInHallway: Record<string, true>
  removedSourceMap: boolean
  advanceScheduled: boolean
  advanceFired: boolean
}

export interface BuildLoopScriptArgs {
  attachment: ExitAttachment
  sourceMapInstanceId: string
  hallwayScopedRoomId: string
}

export function buildLoopTransferredScript(args: BuildLoopScriptArgs): {
  scenarioId: string
  script: GameScript<TransferredState>
  config: Omit<ScenarioConfig, 'id' | 'script'>
} {
  const { attachment, sourceMapInstanceId, hallwayScopedRoomId } = args

  const scheduleAdvance = (state: TransferredState, ctx: GameScriptContext): void => {
    if (state.advanceScheduled || state.advanceFired) return
    state.advanceScheduled = true
    ctx.after(ENTER_GRACE_MS, 'advance')
  }

  const checkAllEntered = (state: TransferredState, ctx: GameScriptContext): void => {
    const living = ctx.getPlayerIds()
    if (living.length === 0) return
    if (!living.every(pid => state.playersInHallway[pid])) return
    if (!state.removedSourceMap) {
      state.removedSourceMap = true
      ctx.removeMap(sourceMapInstanceId)
    }
    scheduleAdvance(state, ctx)
  }

  const script: GameScript<TransferredState> = {
    initialState: () => ({
      listenerRegistered: false,
      warnScheduled: false,
      warned: false,
      eliminationFired: false,
      playersInHallway: {},
      removedSourceMap: false,
      advanceScheduled: false,
      advanceFired: false,
    }),

    onPlayerConnect(state, ctx) {
      if (!state.listenerRegistered) {
        state.listenerRegistered = true
        ctx.onPlayerEnterRoom('onEnter')
      }
      if (!state.warnScheduled) {
        state.warnScheduled = true
        ctx.after(WARN_DELAY_MS, 'warn')
      }
    },

    handlers: {
      onEnter(state, ctx, payload: PlayerEnterRoomPayload) {
        const { roomId, playerId } = payload
        if (roomId !== hallwayScopedRoomId) return
        if (state.playersInHallway[playerId]) return
        state.playersInHallway[playerId] = true
        // Close the exit door behind this player: per-player raise the
        // previous hallway's north wall segment back to solid.
        ctx.setGeometryVisible([attachment.sourceWallIdToDrop], true, [playerId])
        checkAllEntered(state, ctx)
      },

      warn(state, ctx) {
        if (state.warned) return
        state.warned = true
        for (const pid of ctx.getPlayerIds()) {
          if (!state.playersInHallway[pid]) ctx.sendInstruction(pid, RULE_EXIT_SPEC_ID)
        }
        ctx.after(ELIM_DELAY_MS, 'elim')
      },

      elim(state, ctx) {
        if (state.eliminationFired) return
        state.eliminationFired = true
        for (const pid of ctx.getPlayerIds()) {
          if (!state.playersInHallway[pid]) ctx.eliminatePlayer(pid)
        }
        checkAllEntered(state, ctx)
      },

      advance(state, ctx) {
        if (state.advanceFired) return
        state.advanceFired = true
        if (ctx.getPlayerIds().length === 0) return
        ctx.exitScenario()
      },
    },
  }

  return {
    scenarioId: LOOP_SCENARIO_ID,
    script,
    config: {
      instructionSpecs: [RULE_EXIT_INSTRUCTION],
      voteRegions: [],
      initialVisibility: {},
      initialRoomVisibility: {},
    },
  }
}
