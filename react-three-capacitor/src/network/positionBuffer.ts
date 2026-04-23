/**
 * Module-level buffers for remote player state.
 * Kept outside Zustand to avoid triggering React renders on every
 * position update (60 Hz × N players would be excessive).
 *
 * Everything in this module is keyed on the server's tick number.
 * Wall-clock time is intentionally NOT used for any gating decision —
 * if the device's Date.now() drifts from the server's, this code is
 * unaffected. The client's only timing source is the frame loop driving
 * advanceRenderTick().
 */

import type { WorldEvent } from '../game/World'
import { TICK_RATE_HZ } from '../game/World'

// ── Render tick: how many server ticks behind "latest received" we play ───────
//
// BUFFER_TICKS at 20Hz = 5 ticks ≈ 250 ms behind the freshest message we've
// seen. Plays at 1× normally. If lag grows past 1.5× / 3× the buffer the
// playback rate ramps to 2× to catch up — this is the "variable tick duration
// for server event replay" the architecture calls for, and it lives here, not
// in the local input loop.

const BUFFER_TICKS = 5
const SPEED_LO_MULT = 1.5
const SPEED_HI_MULT = 3.0
const MAX_BUFFER_AGE_TICKS = 40  // drop snapshots older than ~2s

let latestServerTick = 0
let renderTickFloat = 0
let renderTickInitialized = false

export function getRenderTick(): number {
  return renderTickFloat
}

export function getLatestServerTick(): number {
  return latestServerTick
}

// Called when any server message carrying a serverTick arrives.
export function registerServerTick(tick: number): void {
  if (tick > latestServerTick) latestServerTick = tick
  if (!renderTickInitialized && latestServerTick > 0) {
    renderTickFloat = Math.max(0, latestServerTick - BUFFER_TICKS)
    renderTickInitialized = true
  }
}

// Call once per frame from a single useFrame, before any reader of the render
// tick this frame.
export function advanceRenderTick(deltaSec: number): void {
  if (!renderTickInitialized) return
  const target = latestServerTick - BUFFER_TICKS
  if (target <= renderTickFloat) return
  const lag = target - renderTickFloat
  const lo = SPEED_LO_MULT * BUFFER_TICKS
  const hi = SPEED_HI_MULT * BUFFER_TICKS
  let speed: number
  if (lag < lo) speed = 1.0
  else if (lag >= hi) speed = 2.0
  else speed = 1.0 + (lag - lo) / (hi - lo)
  renderTickFloat = Math.min(target, renderTickFloat + deltaSec * TICK_RATE_HZ * speed)
}

// ── Remote player position snapshots (interpolated, not consumed) ─────────────

interface PosSnapshot { tick: number; x: number; z: number }

const posBuffers = new Map<string, PosSnapshot[]>()

export function pushRemotePosition(id: string, x: number, z: number, serverTick: number): void {
  let buf = posBuffers.get(id)
  if (!buf) { buf = []; posBuffers.set(id, buf) }
  // Same-tick replacement (e.g. NPC and script may both produce a snapshot for
  // the same server tick); always keep the latest write for a tick.
  if (buf.length > 0 && buf[buf.length - 1].tick === serverTick) {
    buf[buf.length - 1] = { tick: serverTick, x, z }
  } else {
    buf.push({ tick: serverTick, x, z })
  }
  const cutoff = serverTick - MAX_BUFFER_AGE_TICKS
  while (buf.length > 1 && buf[0].tick < cutoff) buf.shift()
}

export function getInterpolatedPos(id: string): { x: number; z: number } | null {
  const buf = posBuffers.get(id)
  if (!buf || buf.length === 0) return null
  const t = renderTickFloat
  if (buf.length === 1 || t <= buf[0].tick) return { x: buf[0].x, z: buf[0].z }
  const last = buf[buf.length - 1]
  if (t >= last.tick) return { x: last.x, z: last.z }
  let lo = 0, hi = buf.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (buf[mid].tick <= t) lo = mid; else hi = mid
  }
  const a = buf[lo], b = buf[hi]
  const alpha = (t - a.tick) / (b.tick - a.tick)
  return { x: a.x + (b.x - a.x) * alpha, z: a.z + (b.z - a.z) * alpha }
}

// ── Remote player world events (consumed once when render tick reaches them) ─

interface TickedEvent { tick: number; event: WorldEvent }

const eventQueues = new Map<string, TickedEvent[]>()

export function pushRemoteEvents(id: string, events: WorldEvent[], serverTick: number): void {
  if (events.length === 0) return
  let q = eventQueues.get(id)
  if (!q) { q = []; eventQueues.set(id, q) }
  for (const event of events) q.push({ tick: serverTick, event })
}

export function consumeRemoteEvents(id: string): WorldEvent[] {
  const q = eventQueues.get(id)
  if (!q || q.length === 0) return []
  const t = renderTickFloat
  const result: WorldEvent[] = []
  while (q.length > 0 && q[0].tick <= t) {
    result.push(q.shift()!.event)
  }
  return result
}

export function clearRemotePlayer(id: string): void {
  posBuffers.delete(id)
  eventQueues.delete(id)
}

// ── move_ack queue for local player reconciliation ────────────────────────────
// Acks may arrive faster than the frame loop consumes them (network bunching),
// and outOfOrder acks must not be silently dropped because they carry the only
// signal that lets the client clear that tick from its prediction history. So
// queue all of them in arrival order.

export interface MoveAck {
  tick: number
  x: number
  z: number
  events: WorldEvent[]
  outOfOrder: boolean
}

let pendingMoveAcks: MoveAck[] = []

export function pushMoveAck(ack: MoveAck): void {
  pendingMoveAcks.push(ack)
}

export function consumeMoveAcks(): MoveAck[] {
  if (pendingMoveAcks.length === 0) return pendingMoveAcks
  const out = pendingMoveAcks
  pendingMoveAcks = []
  return out
}

export function resetBuffers(): void {
  posBuffers.clear()
  eventQueues.clear()
  pendingMoveAcks = []
  latestServerTick = 0
  renderTickFloat = 0
  renderTickInitialized = false
}
