import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ContentRegistry.js'
import type {
  AbilityUsePayload,
  GameScript,
  GameScriptContext,
  PlayerEnterRoomPayload,
} from '../../../react-three-capacitor/server/src/GameScript.js'

// prod_gates scenario.
//
// Map layout (see content/maps/prod_gates/map.ts):
//   spawn    — 0.25 × 0.25  (hub dock on the south edge, open north)
//   corridor — 0.50 × 1.25  (three full-span internal doors: gate1/2/3)
//   victory  — 0.25 × 0.25  (safe zone north of corridor)
//
// Gameplay:
//   1. Every player joining receives a single HUD ability called OPEN.
//   2. Pressing OPEN fires `ability_use` back to this scenario. The handler
//      picks the player's nearest closed gate (must be within DOOR_REACH_Z
//      of the player's world z) and:
//        - drops the gate geometry (globally — the corridor is shared);
//        - rolls a 50% chance to apply 1 damage to the player who pressed.
//      If no closed gate is in range, the press is a silent no-op.
//   3. CONNECT_SETTLE_MS after the first player connects the round starts:
//      scenario closes to new joiners, everyone gets the OPEN ability, and
//      a 30-second timer arms.
//   4. At the 30-second mark, any player not inside the victory room is
//      eliminated. Early termination fires as soon as every still-connected
//      player has reached the victory room.

const CONNECT_SETTLE_MS = 2_000
const ROUND_DURATION_MS = 8_000
const SAFETY_TIMEOUT_MS = 12_000

// World-frame gate z-coords. The corridor room sits at world z = -0.75 (BFS
// from spawn at origin, corridor is 0.75 units north of spawn centre), and
// the gates' local z values are +0.3125, 0, -0.3125. World z = corridor_z +
// local_z. Any drift here will be caught at first run — the gate cz values
// in map.ts are the source of truth; these are derived constants.
const CORR_WORLD_Z = -0.75
const GATES: ReadonlyArray<{ id: string; worldZ: number }> = [
  { id: 'gate1', worldZ: CORR_WORLD_Z + 0.3125 },   // -0.4375  (closest to spawn)
  { id: 'gate2', worldZ: CORR_WORLD_Z + 0        },  // -0.75
  { id: 'gate3', worldZ: CORR_WORLD_Z - 0.3125 },   // -1.0625  (closest to victory)
] as const

// A player must be within this z-distance of a gate (absolute value) for
// the OPEN ability to target it. One band depth is 0.3125, so 0.2 keeps the
// press from targeting the *previous* gate once the player has walked past
// the midpoint of a new band.
const DOOR_REACH_Z = 0.2

const ABILITY_OPEN = 'open'
const VICTORY_ROOM_ID = 'prod_gates_victory'

interface S {
  startScheduled: boolean
  started: boolean
  finished: boolean
  gateOpen: Record<string, boolean>   // gate id → opened?
  inVictory: Record<string, true>     // player id → has reached victory
  abilityGranted: Record<string, true>
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
    return ctx.getPlayerIds().includes(pid)
  }).length
  logEvent('scenario_end', { reason, survivors })
  ctx.exitScenario()
}

function grantOpenTo(state: S, ctx: GameScriptContext, playerId: string): void {
  if (state.abilityGranted[playerId]) return
  state.abilityGranted[playerId] = true
  ctx.grantAbility(playerId, ABILITY_OPEN, { label: 'OPEN', color: '#27ae60' })
}

const script: GameScript<S> = {
  initialState: () => ({
    startScheduled: false,
    started: false,
    finished: false,
    gateOpen: { gate1: false, gate2: false, gate3: false },
    inVictory: {},
    abilityGranted: {},
    listenersRegistered: false,
  }),

  onPlayerConnect(state, ctx, playerId) {
    // If the round already started, grant OPEN immediately so late-joiners
    // still get the ability (e.g. reconnect). Before the round starts the
    // grant happens in `startRound`.
    if (state.started && !state.finished) grantOpenTo(state, ctx, playerId)

    if (!state.startScheduled) {
      state.startScheduled = true
      logEvent('round_scheduled', { delay_ms: CONNECT_SETTLE_MS })
      ctx.after(CONNECT_SETTLE_MS, 'startRound')
    }

    if (state.listenersRegistered) return
    state.listenersRegistered = true
    ctx.onPlayerEnterRoom('onEnterRoom')
    ctx.onAbilityUse(ABILITY_OPEN, 'onOpenUsed')
  },

  handlers: {
    startRound(state, ctx) {
      if (state.started) return
      state.started = true

      ctx.closeScenario()
      for (const pid of ctx.getPlayerIds()) {
        grantOpenTo(state, ctx, pid)
        ctx.sendInstructions(pid, ['rule_open', 'rule_timer'])
      }
      logEvent('scenario_start', { players: ctx.getPlayerIds().length })

      ctx.after(ROUND_DURATION_MS, 'timerExpired')
      ctx.after(SAFETY_TIMEOUT_MS, 'safetyTerminate')
    },

    onEnterRoom(state, ctx, payload: PlayerEnterRoomPayload) {
      if (state.finished) return
      if (payload.roomId !== VICTORY_ROOM_ID) return
      if (state.inVictory[payload.playerId]) return
      state.inVictory[payload.playerId] = true
      ctx.sendInstruction(payload.playerId, 'fact_survived')
      // Player made it — revoke OPEN so the HUD button disappears.
      ctx.revokeAbility(payload.playerId, ABILITY_OPEN)
      delete state.abilityGranted[payload.playerId]
      logEvent('player_entered_victory', { player: payload.playerId })

      const playerIds = ctx.getPlayerIds()
      if (playerIds.length > 0 && playerIds.every(pid => state.inVictory[pid])) {
        finish(state, ctx, 'early_all_in_victory')
      }
    },

    onOpenUsed(state, ctx, payload: AbilityUsePayload) {
      if (state.finished) return
      const pos = ctx.getPlayerPosition(payload.playerId)
      if (!pos) return

      // Pick the closest closed gate within reach on the z-axis.
      let target: { id: string; worldZ: number } | null = null
      let bestDist = Infinity
      for (const g of GATES) {
        if (state.gateOpen[g.id]) continue
        const dz = Math.abs(pos.z - g.worldZ)
        if (dz < bestDist && dz <= DOOR_REACH_Z) {
          bestDist = dz
          target = g
        }
      }
      if (!target) {
        logEvent('open_missed', { player: payload.playerId, pz: pos.z })
        return
      }

      state.gateOpen[target.id] = true
      ctx.setGeometryVisible([target.id], false)

      if (Math.random() < 0.5) {
        logEvent('open_damage', { player: payload.playerId, gate: target.id })
        ctx.applyDamage(payload.playerId, 1)
      } else {
        logEvent('open_no_damage', { player: payload.playerId, gate: target.id })
      }
      logEvent('gate_opened', { gate: target.id, player: payload.playerId })
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
  // victory's north wall is already exactly the hallway width (0.25), so the
  // existing `pg_vict_n` segment is the exit dock as-is — no split needed.
  exitConnection: {
    roomId: 'victory',
    dockGeometryId: 'pg_vict_n',
  },
}
