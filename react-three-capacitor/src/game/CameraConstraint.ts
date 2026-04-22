import type { WorldSpec, RoomWorldPos } from './WorldSpec'

export interface Vec2 { x: number; z: number }

// World-space axis-aligned camera rect for one room.
export interface CameraRect { xMin: number; xMax: number; zMin: number; zMax: number }

// World-space camera transition zone for one connection (convex polygon, 3–4 corners).
export interface CameraZone { corners: ReadonlyArray<Vec2> }

// All constraint shapes in world space; built once at startup from the authored world spec.
export interface CameraConstraintShapes { rects: CameraRect[]; zones: CameraZone[] }

/**
 * Convert per-room camera rects (room-local) and per-connection transition zones
 * (room-A-local) to world-space shapes. Works for any rectangular grid graph of
 * room connections — no north-south chain assumption.
 *
 * Rooms with no authored cameraRect default to a point at the room centre.
 */
export function buildCameraConstraintShapes(
  world: WorldSpec,
  roomPositions: Map<string, RoomWorldPos>,
): CameraConstraintShapes {
  const rects: CameraRect[] = []
  for (const room of world.rooms) {
    const pos = roomPositions.get(room.id)!
    const r = room.cameraRect ?? { xMin: 0, xMax: 0, zMin: 0, zMax: 0 }
    rects.push({
      xMin: pos.x + r.xMin, xMax: pos.x + r.xMax,
      zMin: pos.z + r.zMin, zMax: pos.z + r.zMax,
    })
  }

  const zones: CameraZone[] = []
  for (const conn of world.connections) {
    if (!conn.cameraTransition) continue
    const posA = roomPositions.get(conn.roomIdA)!
    zones.push({
      corners: conn.cameraTransition.corners.map(c => ({
        x: posA.x + c.x,
        z: posA.z + c.z,
      })),
    })
  }

  return { rects, zones }
}

function nearestOnSeg(ax: number, az: number, bx: number, bz: number, px: number, pz: number): Vec2 {
  const dx = bx - ax, dz = bz - az
  const lenSq = dx * dx + dz * dz
  if (lenSq === 0) return { x: ax, z: az }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq))
  return { x: ax + t * dx, z: az + t * dz }
}

function insideRect(r: CameraRect, x: number, z: number): boolean {
  return x >= r.xMin && x <= r.xMax && z >= r.zMin && z <= r.zMax
}

function nearestOnRect(r: CameraRect, x: number, z: number): Vec2 {
  return {
    x: Math.max(r.xMin, Math.min(r.xMax, x)),
    z: Math.max(r.zMin, Math.min(r.zMax, z)),
  }
}

// Ray casting: ray from (x,z) in +X direction; odd crossing count = inside.
function insidePoly(corners: ReadonlyArray<Vec2>, x: number, z: number): boolean {
  const n = corners.length
  let crossings = 0
  for (let i = 0; i < n; i++) {
    const a = corners[i], b = corners[(i + 1) % n]
    if ((a.z <= z && b.z > z) || (b.z <= z && a.z > z)) {
      const t = (z - a.z) / (b.z - a.z)
      if (x < a.x + t * (b.x - a.x)) crossings++
    }
  }
  return crossings % 2 === 1
}

function nearestOnPoly(corners: ReadonlyArray<Vec2>, x: number, z: number): Vec2 {
  let best: Vec2 = corners[0]
  let bestDist = Infinity
  const n = corners.length
  for (let i = 0; i < n; i++) {
    const a = corners[i], b = corners[(i + 1) % n]
    const p = nearestOnSeg(a.x, a.z, b.x, b.z, x, z)
    const d = (p.x - x) ** 2 + (p.z - z) ** 2
    if (d < bestDist) { bestDist = d; best = p }
  }
  return best
}

/**
 * Project (x, z) to the nearest point inside the union of all constraint shapes.
 * Returns the point unchanged if already inside any rect or zone.
 * Uses ray casting for the inside test; works for concave zones.
 */
export function clampToShapes(shapes: CameraConstraintShapes, x: number, z: number): Vec2 {
  for (const r of shapes.rects) {
    if (insideRect(r, x, z)) return { x, z }
  }
  for (const zone of shapes.zones) {
    if (zone.corners.length >= 3 && insidePoly(zone.corners, x, z)) return { x, z }
  }

  let best: Vec2 = { x, z }
  let bestDist = Infinity

  for (const r of shapes.rects) {
    const p = nearestOnRect(r, x, z)
    const d = (p.x - x) ** 2 + (p.z - z) ** 2
    if (d < bestDist) { bestDist = d; best = p }
  }
  for (const zone of shapes.zones) {
    if (zone.corners.length < 2) continue
    const p = nearestOnPoly(zone.corners, x, z)
    const d = (p.x - x) ** 2 + (p.z - z) ** 2
    if (d < bestDist) { bestDist = d; best = p }
  }

  return best
}
