import type { RoomWorldPos, WorldSpec } from './WorldSpec.js'
import type { RoomSpec, Wall } from './RoomSpec.js'

export interface Vec2 { x: number; z: number }

// World-space axis-aligned camera rect for one room. `belongsToRoomLocalId`
// records the local (unscoped) room id of the room this rect was derived from
// so RoomManager can re-key it to a scoped room id when unioning across map
// instances and filter the union by current-room.
export interface CameraRect {
  xMin: number
  xMax: number
  zMin: number
  zMax: number
  belongsToRoomLocalId?: string
}

// World-space camera transition zone for one connection (convex polygon, 3–4
// corners). `belongsToRoomLocalIds` records both local room ids on either side
// of the connection that produced this zone — RoomManager re-keys these to
// scoped ids so the per-current-room filter can include the zone whenever the
// player is in EITHER room. This is per-side: each `'toEdge'` side of a
// connection emits its own quad (one quad bridging the connection segment to
// each room's camera-extent edge).
export interface CameraZone {
  corners: ReadonlyArray<Vec2>
  belongsToRoomLocalIds?: ReadonlyArray<string>
}

// All constraint shapes in world space; built once at startup from the
// authored world spec and rebuilt on map mutation.
export interface CameraConstraintShapes { rects: CameraRect[]; zones: CameraZone[] }

/**
 * Convert per-room camera extents (room-local half-extents centered on the
 * room) to world-space rectangles, plus synthesize transition-bridge zones
 * for every connection side that opted into `transitionRegion: 'toEdge'`.
 * Works for any rectangular grid graph of room connections — no north-south
 * chain assumption.
 *
 * Output annotations: each emitted rect tags its source local room id, and
 * each zone tags both rooms incident on its connection. RoomManager re-keys
 * those into scoped ids when unioning across map instances so the
 * `getCameraShapes({ currentRoomScopedId })` filter can pick the right
 * subset cheaply.
 */
export function buildCameraConstraintShapes(
  world: WorldSpec,
  roomPositions: Map<string, RoomWorldPos>,
): CameraConstraintShapes {
  const rects: CameraRect[] = []
  for (const room of world.rooms) {
    const pos = roomPositions.get(room.id)
    if (!pos) continue
    const ex = room.cameraExtentX
    const ey = room.cameraExtentY
    rects.push({
      xMin: pos.x - ex, xMax: pos.x + ex,
      zMin: pos.z - ey, zMax: pos.z + ey,
      belongsToRoomLocalId: room.id,
    })
  }

  const zones = synthesizeTransitionZones(world, roomPositions)

  return { rects, zones }
}

// Compute the world-space midpoint of a connection side's door (the centre
// of the door opening on the wall), and the wall-parallel half-vector that
// extends from the midpoint to either segment endpoint.
//
// Wall conventions (from RoomSpec): N=-z, S=+z, E=+x, W=-x.
// Door `position` is 0..1 along the wall:
//   N/S walls: 0 = west end (-x), 1 = east end (+x). Wall-parallel axis is +x.
//   E/W walls: 0 = north end (-z), 1 = south end (+z). Wall-parallel axis is +z.
//
// Exported (was previously file-local) so the movement code in
// `Scene.processMove` can reuse the same math when checking whether a wall
// crossing point lies within the door opening — see Task 5's connection-gap
// check.
export function doorSegment(
  room: RoomSpec,
  pos: RoomWorldPos,
  side: { wall: Wall; length: number; position: number },
): { mid: Vec2; halfDir: Vec2 } {
  const halfLen = side.length / 2
  switch (side.wall) {
    case 'north':
      return {
        mid: {
          x: pos.x + (side.position - 0.5) * room.floorWidthX,
          z: pos.z - room.floorDepthY / 2,
        },
        halfDir: { x: halfLen, z: 0 },
      }
    case 'south':
      return {
        mid: {
          x: pos.x + (side.position - 0.5) * room.floorWidthX,
          z: pos.z + room.floorDepthY / 2,
        },
        halfDir: { x: halfLen, z: 0 },
      }
    case 'east':
      return {
        mid: {
          x: pos.x + room.floorWidthX / 2,
          z: pos.z + (side.position - 0.5) * room.floorDepthY,
        },
        halfDir: { x: 0, z: halfLen },
      }
    case 'west':
      return {
        mid: {
          x: pos.x - room.floorWidthX / 2,
          z: pos.z + (side.position - 0.5) * room.floorDepthY,
        },
        halfDir: { x: 0, z: halfLen },
      }
  }
}

// Compute the two endpoints of the camera-extent edge that lies on the same
// side of the room as `wall`. Returned in the same wall-parallel order as
// `doorSegment` (low-x then high-x for N/S; low-z then high-z for E/W) so
// the synthesis can join them into a non-self-intersecting quad.
function cameraEdgePoints(
  room: RoomSpec,
  pos: RoomWorldPos,
  wall: Wall,
): [Vec2, Vec2] {
  const ex = room.cameraExtentX
  const ey = room.cameraExtentY
  switch (wall) {
    case 'north':
      return [
        { x: pos.x - ex, z: pos.z - ey },
        { x: pos.x + ex, z: pos.z - ey },
      ]
    case 'south':
      return [
        { x: pos.x - ex, z: pos.z + ey },
        { x: pos.x + ex, z: pos.z + ey },
      ]
    case 'east':
      return [
        { x: pos.x + ex, z: pos.z - ey },
        { x: pos.x + ex, z: pos.z + ey },
      ]
    case 'west':
      return [
        { x: pos.x - ex, z: pos.z - ey },
        { x: pos.x - ex, z: pos.z + ey },
      ]
  }
}

// Approximately equal Vec2.
function vecApproxEq(a: Vec2, b: Vec2, eps = 1e-9): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.z - b.z) < eps
}

// Build the per-side bridging quad for ONE side of a connection: a
// quadrilateral whose two endpoints are on the door segment and whose other
// two endpoints are on the room's camera-extent edge corresponding to the
// connection's wall.
//
// Degenerate cases:
//   - If the camera extent is a POINT (cameraExtentX = cameraExtentY = 0),
//     the camera edge collapses to a single point; the quad becomes a
//     triangle (segA, segB, point).
//   - If the camera extent is a LINE perpendicular to the wall (zero half-
//     extent along the wall axis), the camera edge collapses to a single
//     point too; same triangle case.
//   - If the camera-extent edge is COINCIDENT with the door-segment line
//     (cameraExtentY = floorDepthY/2 for an N/S wall, etc.), the quad
//     degenerates to a flat line on the wall — we still emit it (4 distinct
//     corners on a line), `clampToShapes` handles 0-area zones gracefully
//     by snapping to the nearest segment.
//   - If the resulting corner list deduplicates to fewer than 3 distinct
//     points, we drop the zone (it cannot meaningfully contribute to the
//     union).
//
// All four corners are emitted in wall-parallel-low → wall-parallel-high
// order on the segment side, then high → low on the camera-edge side, so
// the perimeter doesn't self-cross.
function buildBridgeQuad(
  room: RoomSpec,
  pos: RoomWorldPos,
  side: { wall: Wall; length: number; position: number },
  belongsToRoomLocalIds: ReadonlyArray<string>,
): CameraZone | null {
  const { mid, halfDir } = doorSegment(room, pos, side)
  const segA: Vec2 = { x: mid.x - halfDir.x, z: mid.z - halfDir.z }
  const segB: Vec2 = { x: mid.x + halfDir.x, z: mid.z + halfDir.z }
  const [edgeA, edgeB] = cameraEdgePoints(room, pos, side.wall)

  // Degenerate camera edge (point): emit a triangle (segA, segB, point).
  if (vecApproxEq(edgeA, edgeB)) {
    const corners: Vec2[] = [segA, segB, edgeA]
    const distinct = dedupeCorners(corners)
    if (distinct.length < 3) return null
    return { corners: distinct, belongsToRoomLocalIds }
  }

  // Full quad: trace perimeter as segA → segB → edgeB → edgeA so the two
  // pairs are visited in the same wall-parallel direction without crossing.
  const corners: Vec2[] = [segA, segB, edgeB, edgeA]
  const distinct = dedupeCorners(corners)
  if (distinct.length < 3) return null
  return { corners: distinct, belongsToRoomLocalIds }
}

function dedupeCorners(corners: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const c of corners) {
    if (out.some(o => vecApproxEq(o, c))) continue
    out.push(c)
  }
  return out
}

/**
 * Synthesize per-connection bridge quads for every side that opted into
 * `transitionRegion: 'toEdge'`. Each `'toEdge'` side contributes ONE quad
 * (so a connection where both sides set `'toEdge'` emits two quads, one
 * per room). `'none'` sides contribute nothing — the camera centre simply
 * snaps to the closest existing rect/zone.
 *
 * Both quads on the same connection are tagged with BOTH rooms' local ids
 * via `belongsToRoomLocalIds`, so the per-current-room filter in
 * `RoomManager.getCameraShapes` includes them whenever the player is in
 * either side of the connection.
 */
export function synthesizeTransitionZones(
  spec: WorldSpec,
  roomPositions: Map<string, RoomWorldPos>,
): CameraZone[] {
  const byId = new Map(spec.rooms.map(r => [r.id, r]))
  const zones: CameraZone[] = []

  for (const conn of spec.connections) {
    const roomA = byId.get(conn.roomIdA)
    const roomB = byId.get(conn.roomIdB)
    if (!roomA || !roomB) continue
    const posA = roomPositions.get(conn.roomIdA)
    const posB = roomPositions.get(conn.roomIdB)
    if (!posA || !posB) continue

    const belongs = [conn.roomIdA, conn.roomIdB] as const

    if (conn.room1.transitionRegion === 'toEdge') {
      const quad = buildBridgeQuad(roomA, posA, conn.room1, belongs)
      if (quad) zones.push(quad)
    }
    if (conn.room2.transitionRegion === 'toEdge') {
      const quad = buildBridgeQuad(roomB, posB, conn.room2, belongs)
      if (quad) zones.push(quad)
    }
  }

  return zones
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
