import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ContentRegistry.js'
import type {
  GameScript,
  GameScriptContext,
} from '../../../react-three-capacitor/server/src/GameScript.js'

// prod_gates scenario.
//
// Layout (see content/maps/prod_gates/map.ts):
//   band1 (spawn) z ∈ (+0.35, +0.6)
//   gate1 at z=+0.35   (gate1_wall_l, gate1_wall_r)
//   band2          z ∈ (+0.10, +0.35)
//   gate2 at z=+0.10   (gate2_wall_l, gate2_wall_r)
//   band3          z ∈ (-0.15, +0.10)
//   gate3 at z=-0.15   (gate3_wall_l, gate3_wall_r)
//   band4          z ∈ (-0.40, -0.15)
//   victory_wall at z=-0.40 (victory_wall_l, victory_wall_r) — opened at start
//   victory_room   z < -0.40
//
// Behaviour summary:
// - victory_wall opens immediately at scenario start, joining band4 and the
//   victory area into one "victory room" (z < -0.15 effectively, but the
//   victory threshold for survival is z < -0.40 as specified).
// - Three gates start CLOSED. Each tick, every alive player's nearest
//   CLOSED gate is computed; if they're within PROXIMITY_R of (0, gateZ)
//   they auto-trigger an "open" on that gate (the design called out an
//   ability, but with no button/ability infra wired into the map we use
//   the proximity check as the trigger). Each open: 50% chance to deal 1
//   damage to the activator; gate becomes permanently OPEN (both wall
//   segments removed).
// - 30s after scenario_start, any alive player not in z < -0.40 is
//   eliminated. Survivors = players in victory_room. Always terminate.
// - Early-terminate if every alive player is already in z < -0.40.

const PROXIMITY_R = 0.12
const TICK_MS = 200
const ROUND_DURATION_MS = 30_000
const SAFETY_TIMEOUT_MS = 38_000

const GATES = [
  { id: 'gate1', z:  0.35, walls: ['gate1_wall_l', 'gate1_wall_r'] },
  { id: 'gate2', z:  0.10, walls: ['gate2_wall_l', 'gate2_wall_r'] },
  { id: 'gate3', z: -0.15, walls: ['gate3_wall_l', 'gate3_wall_r'] },
] as const
const VICTORY_WALLS = ['victory_wall_l', 'victory_wall_r']
const VICTORY_Z = -0.40

interface S {
  started: boolean
  finished: boolean
  startTime: number
  gateOpen: Record<string, boolean>
  inVictory: Record<string, boolean>
  damageRoll: Record<string, number>
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  // Structured one-line logs the test harness can grep.
  const parts = [`[prod_gates] ${event}`]
  for (const [k, v] of Object.entries(fields)) parts.push(`${k}=${JSON.stringify(v)}`)
  console.log(parts.join(' '))
}

function dist2D(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx
  const dz = az - bz
  return Math.sqrt(dx * dx + dz * dz)
}

function nearestClosedGate(
  state: S,
  px: number,
  pz: number,
): { id: string; z: number; walls: readonly string[]; dist: number } | null {
  let best: { id: string; z: number; walls: readonly string[]; dist: number } | null = null
  for (const g of GATES) {
    if (state.gateOpen[g.id]) continue
    const d = dist2D(px, pz, 0, g.z)
    if (best === null || d < best.dist) {
      best = { id: g.id, z: g.z, walls: g.walls, dist: d }
    }
  }
  return best
}

function startScenario(state: S, ctx: GameScriptContext): void {
  if (state.started) return
  state.started = true
  state.startTime = Date.now()

  // Open victory_wall immediately (band4 + victory area become one room).
  ctx.setGeometryVisible(VICTORY_WALLS, false)

  const playerIds = ctx.getPlayerIds()
  log('scenario_start', { players: playerIds.length })

  ctx.after(TICK_MS, 'tick')
  ctx.after(ROUND_DURATION_MS, 'timerExpired')
  ctx.after(SAFETY_TIMEOUT_MS, 'safetyTerminate')
}

function finish(state: S, ctx: GameScriptContext, reason: string): void {
  if (state.finished) return
  state.finished = true
  const survivors = ctx.getPlayerIds().filter(pid => {
    const pos = ctx.getPlayerPosition(pid)
    return pos !== null && pos.z < VICTORY_Z
  }).length
  log('scenario_end', { reason, survivors })
  ctx.terminate()
}

const script: GameScript<S> = {
  initialState: () => ({
    started: false,
    finished: false,
    startTime: 0,
    gateOpen: { gate1: false, gate2: false, gate3: false },
    inVictory: {},
    damageRoll: {},
  }),

  onPlayerConnect(state, ctx) {
    if (!state.started) startScenario(state, ctx)
  },

  handlers: {
    tick(state, ctx) {
      if (state.finished) return

      const playerIds = ctx.getPlayerIds()
      if (playerIds.length === 0) {
        finish(state, ctx, 'no_players')
        return
      }

      let allInVictory = true

      for (const pid of playerIds) {
        const pos = ctx.getPlayerPosition(pid)
        if (pos === null) {
          allInVictory = false
          continue
        }

        // Track victory entry.
        const inV = pos.z < VICTORY_Z
        if (inV && !state.inVictory[pid]) {
          state.inVictory[pid] = true
          log('player_entered_victory', { player: pid, z: pos.z })
        }
        if (!inV) allInVictory = false

        // Auto-open nearest closed gate when in proximity.
        const near = nearestClosedGate(state, pos.x, pos.z)
        if (near !== null && near.dist <= PROXIMITY_R) {
          // Open the gate.
          state.gateOpen[near.id] = true
          ctx.setGeometryVisible([...near.walls], false)
          // 50% damage roll.
          if (Math.random() < 0.5) {
            log('open_damage', { player: pid, gate: near.id })
            ctx.applyDamage(pid, 1)
          } else {
            log('open_no_damage', { player: pid, gate: near.id })
          }
          log('gate_opened', { gate: near.id, player: pid })
        }
      }

      // Re-check players (some may have been eliminated by damage).
      const stillAlive = ctx.getPlayerIds()
      if (stillAlive.length === 0) {
        finish(state, ctx, 'all_eliminated')
        return
      }

      // Early-terminate: every alive player already in victory_room.
      if (allInVictory && stillAlive.length > 0) {
        // Re-evaluate against actual living players.
        const everyoneIn = stillAlive.every(pid => {
          const pos = ctx.getPlayerPosition(pid)
          return pos !== null && pos.z < VICTORY_Z
        })
        if (everyoneIn) {
          finish(state, ctx, 'early_all_in_victory')
          return
        }
      }

      ctx.after(TICK_MS, 'tick')
    },

    timerExpired(state, ctx) {
      if (state.finished) return

      const alive = ctx.getPlayerIds()
      let survivors = 0
      let eliminated = 0
      for (const pid of alive) {
        const pos = ctx.getPlayerPosition(pid)
        if (pos !== null && pos.z < VICTORY_Z) {
          survivors++
        } else {
          ctx.eliminatePlayer(pid)
          eliminated++
        }
      }
      log('timer_expired', { survivors, eliminated })
      finish(state, ctx, 'timer_expired')
    },

    safetyTerminate(state, ctx) {
      if (state.finished) return
      log('safety_terminate', {})
      finish(state, ctx, 'safety_timeout')
    },
  },
}

export const SCENARIO: ScenarioSpec = {
  id: 'prod_gates',
  timeoutMs: SAFETY_TIMEOUT_MS + 2_000,
  maxPlayers: 4,
  script,
  requiredRoomIds: ['prod_gates_corridor'],
}
