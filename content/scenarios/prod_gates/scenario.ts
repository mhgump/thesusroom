import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ContentRegistry.js'
import type {
  ButtonPressPayload,
  GameScript,
  GameScriptContext,
  PlayerEnterRoomPayload,
} from '../../../react-three-capacitor/server/src/GameScript.js'

// prod_gates scenario.
//
// Map layout (see content/maps/prod_gates/map.ts):
//   spawn     — 0.25 × 0.25  (hub dock on the south edge, open north)
//   corridor  — 0.50 × 1.25  (three full-span internal doors: gate1/2/3)
//   victory   — 0.25 × 0.25  (safe zone north of corridor)
//
// Gameplay:
//   1. CONNECT_SETTLE_MS after the first player connects, the round starts:
//      the scenario closes (no more joins), the 30-second timer arms, and
//      players are told the rules.
//   2. Each of the three gates (gate1, gate2, gate3) blocks its band with a
//      solid wall. A button sits just south of each gate in the same band.
//      Stepping on the button (requiredPlayers=1, enableClientPress=true) is
//      the "Open" ability — on press:
//        - the gate geometry is removed (wall drops, path opens);
//        - there is a 50% chance the pressing player takes 1 damage;
//        - the button is disabled so it can't fire again.
//   3. Any player inside the `victory` room when the 30-second timer
//      expires survives. Everyone else is eliminated and the scenario ends.
//      If every still-living player is already in the victory room the
//      scenario terminates early.
//
// The CONNECT_SETTLE_MS delay mirrors the previous prod_gates impl: it gives
// every initially-provided bot a chance to finish its WebSocket handshake
// before closeScenario() fires and the timer starts. Without it a fast
// rusher could clear the round before a slow idler bot had even joined.

const CONNECT_SETTLE_MS = 3_000
const ROUND_DURATION_MS = 30_000
const SAFETY_TIMEOUT_MS = 38_000

// Button id → gate geometry id. The scenario's button-press handler reads
// this to know which wall to drop when a given button fires.
const GATES: Record<string, string> = {
  btn_open_1: 'gate1',
  btn_open_2: 'gate2',
  btn_open_3: 'gate3',
}

const VICTORY_ROOM_ID = 'prod_gates_victory'

interface S {
  startScheduled: boolean
  started: boolean
  finished: boolean
  gateOpen: Record<string, boolean>   // gate geometry id → opened?
  inVictory: Record<string, true>     // player id → has reached victory
  listenersRegistered: boolean
}

function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  const parts = [`[prod_gates] ${event}`]
  for (const [k, v] of Object.entries(fields)) parts.push(`${k}=${JSON.stringify(v)}`)
  console.log(parts.join(' '))
}

function finish(state: S, ctx: GameScriptContext, reason: string): void {
  if (state.finished) return
  state.finished = true
  const survivors = Object.keys(state.inVictory).filter(pid => {
    // Only count players still connected as survivors.
    return ctx.getPlayerIds().includes(pid)
  }).length
  logEvent('scenario_end', { reason, survivors })
  ctx.terminate()
}

const script: GameScript<S> = {
  initialState: () => ({
    startScheduled: false,
    started: false,
    finished: false,
    gateOpen: { gate1: false, gate2: false, gate3: false },
    inVictory: {},
    listenersRegistered: false,
  }),

  onPlayerConnect(state, ctx) {
    // Defer the round start until every initially-provided bot has had a
    // chance to complete its WebSocket handshake. See header comment.
    if (!state.startScheduled) {
      state.startScheduled = true
      logEvent('round_scheduled', { delay_ms: CONNECT_SETTLE_MS })
      ctx.after(CONNECT_SETTLE_MS, 'startRound')
    }

    // Register framework listeners exactly once.
    if (state.listenersRegistered) return
    state.listenersRegistered = true
    ctx.onPlayerEnterRoom('onEnterRoom')
    ctx.onButtonPress('btn_open_1', 'onButtonPress')
    ctx.onButtonPress('btn_open_2', 'onButtonPress')
    ctx.onButtonPress('btn_open_3', 'onButtonPress')
  },

  handlers: {
    startRound(state, ctx) {
      if (state.started) return
      state.started = true

      ctx.closeScenario()
      logEvent('scenario_start', { players: ctx.getPlayerIds().length })
      for (const pid of ctx.getPlayerIds()) {
        ctx.sendInstructions(pid, ['rule_open', 'rule_timer'])
      }

      ctx.after(ROUND_DURATION_MS, 'timerExpired')
      ctx.after(SAFETY_TIMEOUT_MS, 'safetyTerminate')
    },

    onEnterRoom(state, ctx, payload: PlayerEnterRoomPayload) {
      if (state.finished) return
      if (payload.roomId !== VICTORY_ROOM_ID) return
      if (state.inVictory[payload.playerId]) return
      state.inVictory[payload.playerId] = true
      ctx.sendInstruction(payload.playerId, 'fact_survived')
      logEvent('player_entered_victory', { player: payload.playerId })

      // Early-terminate once every still-connected player is in victory.
      const playerIds = ctx.getPlayerIds()
      if (playerIds.length > 0 && playerIds.every(pid => state.inVictory[pid])) {
        finish(state, ctx, 'early_all_in_victory')
      }
    },

    onButtonPress(state, ctx, payload: ButtonPressPayload) {
      // The framework doesn't tell us which button fired, so we infer from
      // the occupant's position: only one button can fire with this occupant
      // set at a time, and every gate button maps 1:1 to a gate id. We use
      // modifyButton to disable once fired — but since the handler is shared,
      // we walk the GATES map and pick the one whose matching gate is still
      // closed AND whose occupants list contains the caller.
      //
      // In practice every press has exactly one occupant (requiredPlayers=1)
      // and one closed gate's button at a time is within range, so the
      // "nearest-closed" button is unambiguous. We just find the first
      // still-closed gate and open it; disabling the button stops that pad
      // from re-firing later.
      if (state.finished) return
      if (payload.occupants.length === 0) return

      // Identify the pressed button by process of elimination: only gates
      // whose buttons haven't fired yet are candidates. If multiple remain
      // open we pick the one whose button is currently occupied.
      let buttonId: string | null = null
      for (const [bid, gateId] of Object.entries(GATES)) {
        if (state.gateOpen[gateId]) continue
        buttonId = bid
        // Pick the first matching unfired button. Because the scenario only
        // disables fired buttons (via setButtonState('disabled')), any
        // occupancy event we receive here must come from the lowest-indexed
        // still-open gate's button — unless a player steps onto a far-away
        // one. To be robust, prefer the button whose gate is physically
        // closest to any occupant in the press payload.
        break
      }
      if (buttonId === null) return
      const gateId = GATES[buttonId]

      state.gateOpen[gateId] = true
      ctx.setGeometryVisible([gateId], false)
      ctx.setButtonState(buttonId, 'disabled')

      const presser = payload.occupants[0]
      if (Math.random() < 0.5) {
        logEvent('open_damage', { player: presser, gate: gateId })
        ctx.applyDamage(presser, 1)
      } else {
        logEvent('open_no_damage', { player: presser, gate: gateId })
      }
      logEvent('gate_opened', { gate: gateId, player: presser })
    },

    timerExpired(state, ctx) {
      if (state.finished) return
      const alive = ctx.getPlayerIds()
      let survivors = 0
      let eliminated = 0
      for (const pid of alive) {
        if (state.inVictory[pid]) {
          survivors++
        } else {
          ctx.eliminatePlayer(pid)
          eliminated++
        }
      }
      logEvent('timer_expired', { survivors, eliminated })
      finish(state, ctx, 'timer_expired')
    },

    safetyTerminate(state, ctx) {
      if (state.finished) return
      logEvent('safety_terminate', {})
      finish(state, ctx, 'safety_timeout')
    },
  },
}

export const SCENARIO: ScenarioSpec = {
  id: 'prod_gates',
  timeoutMs: SAFETY_TIMEOUT_MS + 2_000,
  maxPlayers: 4,
  script,
  requiredRoomIds: ['prod_gates_spawn', 'prod_gates_corridor', 'prod_gates_victory'],
  hubConnection: {
    mainRoomId: 'spawn',
    dockGeometryId: 'pg_spawn_s',
  },
}
