/**
 * Module-level buffers for remote player state.
 * Kept outside Zustand to avoid triggering React renders on every
 * position update (60 Hz × N players would be excessive).
 *
 * Update events: player_update and move_ack messages. These carry authoritative
 * server timestamps (startTime, endTime) and drive the server time anchor.
 *
 * Internal events: WorldEvents emitted by processMove during an update event
 * (update_animation_state, touched). They inherit the enclosing update's
 * startTime/endTime.
 *
 * Positions: stored as snapshots keyed by server endTime and sampled via
 * interpolation at (estimatedServerTime − delayMs).
 *
 * Events: stored as a consumed queue. Each event is delivered once when
 * max(receiptTime, serverStartTime + delayMs) has elapsed. If the event
 * arrives late (receiptTime > serverStartTime + delayMs), it plays immediately
 * for the remaining portion of its server-time window.
 *
 * move_ack: single-slot for the latest ack from the server for the local
 * player. Consumed once per frame by Player.tsx.
 */

import type { WorldEvent } from '../game/World'

const BUFFER_MAX_AGE_MS = 2000

// ── Server time tracking ──────────────────────────────────────────────────────
// Anchors estimated server time to the most recently received update event.
// estimatedServerTime() advances with the client wall clock from that anchor.

interface ServerTimeAnchor {
  serverTime: number
  clientTime: number
}

let serverTimeAnchor: ServerTimeAnchor = { serverTime: 0, clientTime: 0 }

export function updateServerTime(serverEndTime: number): void {
  serverTimeAnchor = { serverTime: serverEndTime, clientTime: Date.now() }
}

export function estimatedServerTime(): number {
  return serverTimeAnchor.serverTime + (Date.now() - serverTimeAnchor.clientTime)
}

// ── Remote player position snapshots (interpolated, not consumed) ─────────────

interface PosSnapshot {
  t: number  // server endTime
  x: number
  z: number
}

const posBuffers = new Map<string, PosSnapshot[]>()

export function pushRemotePosition(id: string, x: number, z: number, serverEndTime: number): void {
  let buf = posBuffers.get(id)
  if (!buf) { buf = []; posBuffers.set(id, buf) }
  buf.push({ t: serverEndTime, x, z })
  const cutoff = serverEndTime - BUFFER_MAX_AGE_MS
  while (buf.length > 1 && buf[0].t < cutoff) buf.shift()
}

export function getInterpolatedPos(id: string, delayMs: number): { x: number; z: number } | null {
  const buf = posBuffers.get(id)
  if (!buf || buf.length === 0) return null
  const renderT = estimatedServerTime() - delayMs
  if (buf.length === 1 || renderT <= buf[0].t) return { x: buf[0].x, z: buf[0].z }
  const last = buf[buf.length - 1]
  if (renderT >= last.t) return { x: last.x, z: last.z }
  let lo = 0, hi = buf.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (buf[mid].t <= renderT) lo = mid; else hi = mid
  }
  const a = buf[lo], b = buf[hi]
  const alpha = (renderT - a.t) / (b.t - a.t)
  return { x: a.x + (b.x - a.x) * alpha, z: a.z + (b.z - a.z) * alpha }
}

// ── Remote player world events (consumed once, with remaining duration) ───────

interface TimedEvent {
  receiptTime: number      // client wall-clock time when message was received
  serverStartTime: number
  serverEndTime: number
  event: WorldEvent
}

const eventQueues = new Map<string, TimedEvent[]>()

export function pushRemoteEvents(
  id: string,
  events: WorldEvent[],
  serverStartTime: number,
  serverEndTime: number,
): void {
  if (events.length === 0) return
  let q = eventQueues.get(id)
  if (!q) { q = []; eventQueues.set(id, q) }
  const receiptTime = Date.now()
  for (const event of events) q.push({ receiptTime, serverStartTime, serverEndTime, event })
}

export function consumeRemoteEvents(
  id: string,
  delayMs: number,
): Array<{ event: WorldEvent; remainingMs: number }> {
  const q = eventQueues.get(id)
  if (!q || q.length === 0) return []
  const now = Date.now()
  const result: Array<{ event: WorldEvent; remainingMs: number }> = []
  while (q.length > 0) {
    const item = q[0]
    // Play at the later of: when the buffer delay expires (server-time anchor),
    // or immediately if the event arrived after its scheduled play window.
    const playAt = Math.max(item.receiptTime, item.serverStartTime + delayMs)
    if (now < playAt) break
    q.shift()
    const remainingMs = Math.max(0, item.serverEndTime + delayMs - now)
    result.push({ event: item.event, remainingMs })
  }
  return result
}

export function clearRemotePlayer(id: string): void {
  posBuffers.delete(id)
  eventQueues.delete(id)
}

// ── move_ack for local player reconciliation (immediate, not buffered) ─────────

interface MoveAck {
  seq: number
  x: number
  z: number
  events: WorldEvent[]
}

let pendingMoveAck: MoveAck | null = null

export function setMoveAck(
  seq: number,
  x: number,
  z: number,
  events: WorldEvent[],
  serverEndTime: number,
): void {
  if (pendingMoveAck && seq <= pendingMoveAck.seq) return
  updateServerTime(serverEndTime)
  pendingMoveAck = { seq, x, z, events }
}

export function consumeMoveAck(): MoveAck | null {
  const a = pendingMoveAck
  pendingMoveAck = null
  return a
}
