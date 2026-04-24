import type { BotSpec, BotCallbackContext } from '../../../../react-three-capacitor/server/src/bot/BotTypes.js'
import {
  MovementIntent,
  isAtTarget,
  moveToward,
} from '../../../../react-three-capacitor/server/src/bot/BotTypes.js'

/**
 * FILL_BOT — scenario1 fill persona that drives the scenario to completion.
 *
 * Phases:
 * - vote:    every 0.2–0.8s, check if standing alone in a vote region (no
 *            other player within VOTE_RADIUS of the same circle). If yes,
 *            idle. Otherwise, retarget to the closest vote region with no
 *            other player in it. The random check interval prevents two
 *            bots from oscillating in lock-step when they collide on the
 *            same region. Tiebreaks distance with random jitter so bots
 *            spawning at the same point (server default spawn = 0,0)
 *            don't all pick the same circle.
 * - subroom: triggered by `subroom_instruction` from the scenario after the
 *            vote completes. Walks straight north into the assigned 0.5×0.5
 *            sub-room (vx is read from current position — by then the bot
 *            is sitting in its assigned vote circle).
 * - transit: triggered by `final_instruction` after eliminations. Walks
 *            straight north past the sub-room's dropped north wall and the
 *            final room's dropped south door.
 * - final:   moves to the final room's center (0, -1.25). Set when the bot
 *            crosses into the final room (z < SUB_NORTH_Z).
 * - done:    idle.
 */

const VOTE_REGIONS = [
  { id: 's1_v1', x: -0.6, z: -0.2 },
  { id: 's1_v2', x: -0.2, z: -0.2 },
  { id: 's1_v3', x:  0.2, z: -0.2 },
  { id: 's1_v4', x:  0.6, z: -0.2 },
]
const VOTE_RADIUS = 0.08

// Geometry constants mirrored from content/maps/scenario1/map.ts. Kept in
// sync by hand because bots can't import the map module without dragging
// in the rest of the world spec at type-check time.
const MAIN_HD       = 0.375
const MAIN_NORTH_Z  = -MAIN_HD              // -0.375 (sub-room south face)
const SUB_DEPTH     = 0.5
const SUB_CENTER_Z  = MAIN_NORTH_Z - SUB_DEPTH / 2  // -0.625
const SUB_NORTH_Z   = MAIN_NORTH_Z - SUB_DEPTH      // -0.875
const FINAL_DEPTH   = 0.75
const FINAL_CENTER  = { x: 0, z: SUB_NORTH_Z - FINAL_DEPTH / 2 }  // (0, -1.25)

const TARGET_RADIUS_TIGHT = 0.04
const TARGET_RADIUS_LOOSE = 0.05

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function pickClosest<T extends { x: number; z: number }>(
  pos: { x: number; z: number },
  candidates: T[],
): T {
  let best = candidates[0]
  let bestD = distance(pos, best) + Math.random() * 0.01
  for (let i = 1; i < candidates.length; i++) {
    const d = distance(pos, candidates[i]) + Math.random() * 0.01
    if (d < bestD) { bestD = d; best = candidates[i] }
  }
  return best
}

// Random check interval (ms). Each tick the bot only re-evaluates whether
// it's alone in a vote region after the previous interval has elapsed —
// in between it keeps moving toward its current chosen region.
const CHECK_INTERVAL_MIN_MS = 200
const CHECK_INTERVAL_MAX_MS = 800

function regionContaining(pos: { x: number; z: number }): string | null {
  for (const r of VOTE_REGIONS) {
    if (distance(pos, r) <= VOTE_RADIUS - 0.01) return r.id
  }
  return null
}

function voteNextCommand(ctx: BotCallbackContext, pos: { x: number; z: number }) {
  let chosenId = ctx.state.chosenRegion as string | null
  const now = Date.now()
  const nextCheckMs = (ctx.state.nextCheckMs as number | undefined) ?? 0

  if (now >= nextCheckMs) {
    ctx.updateBotState({
      nextCheckMs: now + CHECK_INTERVAL_MIN_MS +
        Math.random() * (CHECK_INTERVAL_MAX_MS - CHECK_INTERVAL_MIN_MS),
    })

    const here = regionContaining(pos)
    const others = Array.from(ctx.getOtherPlayers().values())

    if (here) {
      const region = VOTE_REGIONS.find(r => r.id === here)!
      const sharing = others.some(o => distance(o, region) <= VOTE_RADIUS)
      if (!sharing) {
        ctx.updateBotState({ chosenRegion: here })
        return { type: 'idle' as const }
      }
    }

    // Not alone in a region — pick the closest region that no other
    // player is currently inside.
    const free = VOTE_REGIONS.filter(r =>
      !others.some(o => distance(o, r) <= VOTE_RADIUS),
    )
    const candidates = free.length > 0 ? free : VOTE_REGIONS
    const chosen = pickClosest(pos, candidates)
    chosenId = chosen.id
    ctx.updateBotState({ chosenRegion: chosenId })
  }

  if (!chosenId) return { type: 'idle' as const }
  const region = VOTE_REGIONS.find(r => r.id === chosenId)!
  return moveToward(pos, { type: 'circle', x: region.x, z: region.z, radius: TARGET_RADIUS_TIGHT })
}

export const FILL_BOT: BotSpec = {
  phases: ['vote', 'subroom', 'transit', 'final', 'done'],
  initialState: {
    phase: 'vote',
    intent: MovementIntent.COMMIT,
    target: null,
    chosenRegion: null,
    nextCheckMs: 0,
  },
  onInstructMap: {
    find_instruction: () => {
      // The vote phase starts moving on its own — no extra trigger needed.
    },
    subroom_instruction: (ctx) => {
      const pos = ctx.getPosition()
      // By the time subroom_instruction fires the bot is standing in (or
      // very near) its assigned vote circle. Closest VOTE_X is the bot's
      // sub-room.
      const region = pickClosest(pos, VOTE_REGIONS)
      ctx.updateBotState({
        phase: 'subroom',
        target: { type: 'circle', x: region.x, z: SUB_CENTER_Z, radius: TARGET_RADIUS_LOOSE },
      })
    },
    final_instruction: (ctx) => {
      const pos = ctx.getPosition()
      // Walk straight north out of the sub-room first; switching to the
      // final-room center while still inside the sub-room would steer the
      // bot diagonally into the sub-room's east/west wall.
      ctx.updateBotState({
        phase: 'transit',
        target: { type: 'circle', x: pos.x, z: SUB_NORTH_Z - 0.10, radius: TARGET_RADIUS_LOOSE },
      })
    },
  },
  onOtherPlayerMove: {
    vote: () => {},
    subroom: () => {},
    transit: () => {},
    final: () => {},
    done: () => {},
  },
  onActiveVoteAssignmentChange: {
    // The vote phase polls other players' positions on its own check
    // interval, so we don't need to react to server-side assignment
    // broadcasts here.
    vote: () => {},
    subroom: () => {},
    transit: () => {},
    final: () => {},
    done: () => {},
  },
  nextCommand: {
    vote: voteNextCommand,
    subroom: (ctx, pos) => {
      const target = ctx.state.target
      if (!target || isAtTarget(pos, target)) return { type: 'idle' }
      return moveToward(pos, target)
    },
    transit: (ctx, pos) => {
      // Once we've crossed the sub→final boundary, retarget to the center.
      if (pos.z < SUB_NORTH_Z - 0.05) {
        const finalTarget = { type: 'circle' as const, x: FINAL_CENTER.x, z: FINAL_CENTER.z, radius: TARGET_RADIUS_LOOSE }
        ctx.updateBotState({ phase: 'final', target: finalTarget })
        return moveToward(pos, finalTarget)
      }
      const target = ctx.state.target
      if (!target) return { type: 'idle' }
      return moveToward(pos, target)
    },
    final: (ctx, pos) => {
      const target = ctx.state.target
      if (!target) return { type: 'idle' }
      if (isAtTarget(pos, target)) {
        ctx.updateBotState({ phase: 'done', target: null })
        return { type: 'idle' }
      }
      return moveToward(pos, target)
    },
    done: () => ({ type: 'idle' }),
  },
}

export default FILL_BOT
