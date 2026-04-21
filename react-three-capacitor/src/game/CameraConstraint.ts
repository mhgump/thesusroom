import type { WorldSpec, RoomWorldPos } from './WorldSpec'
import type { RoomSpec } from './RoomSpec'

export interface Vec2 { x: number; z: number }

function cameraRectForRoom(
  room: RoomSpec,
  pos: RoomWorldPos,
  halfViewW: number,
  halfViewGroundZ: number,
): { xMin: number; xMax: number; zMin: number; zMax: number } {
  const txBound = room.cameraRect === 'full'
    ? room.floorWidth / 2
    : Math.max(0, room.floorWidth / 2 - halfViewW)
  const tzBound = room.cameraRect === 'full'
    ? room.floorDepth / 2
    : Math.max(0, room.floorDepth / 2 - halfViewGroundZ)
  return {
    xMin: pos.x - txBound, xMax: pos.x + txBound,
    zMin: pos.z - tzBound, zMax: pos.z + tzBound,
  }
}

// Walk north-south connections to produce room ids south-to-north.
function chainSouthToNorth(world: WorldSpec): string[] {
  const hasSouthConn = new Set<string>()
  for (const conn of world.connections) {
    if (conn.wallA === 'south') hasSouthConn.add(conn.roomIdA)
    if (conn.wallB === 'south') hasSouthConn.add(conn.roomIdB)
  }
  let cur: string | undefined =
    world.rooms.find(r => !hasSouthConn.has(r.id))?.id ?? world.rooms[0].id
  const result: string[] = []
  const visited = new Set<string>()
  while (cur && !visited.has(cur)) {
    result.push(cur)
    visited.add(cur)
    const conn = world.connections.find(
      c => (c.roomIdA === cur && c.wallA === 'north') ||
           (c.roomIdB === cur && c.wallB === 'north'),
    )
    if (!conn) break
    cur = conn.roomIdA === cur ? conn.roomIdB : conn.roomIdA
  }
  return result
}

/**
 * Build a convex polygon representing all allowed camera positions across the
 * entire world. Each room contributes a camera rect; adjacent rooms are bridged
 * by a trapezoid (or triangle when one face is a point). The polygon is walked
 * along the east side south→north and the west side north→south.
 */
export function buildCameraConstraintPoly(
  world: WorldSpec,
  roomPositions: Map<string, RoomWorldPos>,
  halfViewW: number,
  halfViewGroundZ: number,
): Vec2[] {
  const ids = chainSouthToNorth(world)
  const byId = new Map(world.rooms.map(r => [r.id, r]))
  const rects = ids.map(id =>
    cameraRectForRoom(byId.get(id)!, roomPositions.get(id)!, halfViewW, halfViewGroundZ),
  )

  const east: Vec2[] = []
  const west: Vec2[] = []

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]
    if (i === 0) {
      east.push({ x: r.xMax, z: r.zMax })  // south-east of first room
      west.push({ x: r.xMin, z: r.zMax })  // south-west of first room
    }
    east.push({ x: r.xMax, z: r.zMin })    // north-east of this room
    west.push({ x: r.xMin, z: r.zMin })    // north-west of this room
    if (i + 1 < rects.length) {
      const next = rects[i + 1]
      east.push({ x: next.xMax, z: next.zMax })  // south-east of next room (trapezoid)
      west.push({ x: next.xMin, z: next.zMax })  // south-west of next room (trapezoid)
    }
  }

  // East side south→north + west side north→south forms the closed polygon.
  const poly = [...east, ...west.reverse()]

  // Remove consecutive duplicates (degenerate point/line rooms produce them).
  return poly.filter((v, i, arr) => {
    const next = arr[(i + 1) % arr.length]
    return v.x !== next.x || v.z !== next.z
  })
}

function nearestOnSeg(ax: number, az: number, bx: number, bz: number, px: number, pz: number): Vec2 {
  const dx = bx - ax, dz = bz - az
  const lenSq = dx * dx + dz * dz
  if (lenSq === 0) return { x: ax, z: az }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq))
  return { x: ax + t * dx, z: az + t * dz }
}

/**
 * Project (x, z) onto the nearest point inside the polygon.
 * If already inside, returns the point unchanged (no snapping).
 * Uses ray casting for the inside test so it works for any simple polygon,
 * including concave shapes produced by room chains with varying widths.
 */
export function clampToPoly(poly: Vec2[], x: number, z: number): Vec2 {
  const n = poly.length
  if (n === 0) return { x, z }
  if (n === 1) return poly[0]

  // Ray casting: ray from (x,z) in +X direction; odd crossing count = inside.
  let crossings = 0
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n]
    if ((a.z <= z && b.z > z) || (b.z <= z && a.z > z)) {
      const t = (z - a.z) / (b.z - a.z)
      if (x < a.x + t * (b.x - a.x)) crossings++
    }
  }
  if (crossings % 2 === 1) return { x, z }

  let best: Vec2 = poly[0]
  let bestDist = Infinity
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n]
    const p = nearestOnSeg(a.x, a.z, b.x, b.z, x, z)
    const d = (p.x - x) ** 2 + (p.z - z) ** 2
    if (d < bestDist) { bestDist = d; best = p }
  }
  return best
}
