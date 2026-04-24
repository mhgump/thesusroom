import type { GeometrySpec, RoomSpec, Wall } from './RoomSpec.js'

// A doorway between two rooms.
// positionA/B: 0..1 along the wall (N/S = fraction of floorWidth; E/W = fraction of floorDepth)
// width: opening width in world units
// cameraTransition: designer-specified convex polygon (3–4 corners) bridging the two rooms'
//   camera rects. Corners are in room A's local coordinate frame (add room A's world position
//   to convert to world space). Omit only when the two camera rects share a boundary with no gap.
//
// Connections are the *sole* source of both physical adjacency (which rooms a
// player may walk between) and the world-space placement of rooms: a BFS over
// `connections` starting at `rooms[0]` (placed at origin) assigns each room a
// world-space centre.
export interface RoomConnection {
  roomIdA: string
  wallA: Wall
  positionA: number
  roomIdB: string
  wallB: Wall
  positionB: number
  width: number
  cameraTransition?: {
    corners: ReadonlyArray<{ readonly x: number; readonly z: number }>
  }
}

// The subset of a `GameMap` the topology helpers in this module need: the
// rooms list, the connections that place them in world space, and an optional
// origin for rooms[0]. A `GameMap` satisfies this shape directly — callers
// pass the whole map where a `WorldSpec` parameter is declared.
export interface WorldSpec {
  rooms: RoomSpec[]
  connections: RoomConnection[]
  // Optional world-space anchor for rooms[0]. When omitted, rooms[0] is placed
  // at the world origin.
  origin?: RoomWorldPos
}

export interface RoomWorldPos { x: number; z: number }

// BFS from rooms[0] (placed at `spec.origin`, defaulting to the world origin)
// to derive world-space centres for all rooms by walking `connections`. Every
// room reachable from rooms[0] gets a position; unreachable rooms are omitted
// (validateWorldSpec rejects this).
export function computeRoomPositions(spec: WorldSpec): Map<string, RoomWorldPos> {
  const pos = new Map<string, RoomWorldPos>()
  if (!spec.rooms.length) return pos

  const origin = spec.origin ?? { x: 0, z: 0 }
  pos.set(spec.rooms[0].id, { x: origin.x, z: origin.z })
  const visited = new Set([spec.rooms[0].id])
  const queue = [spec.rooms[0].id]
  const byId = new Map(spec.rooms.map(r => [r.id, r]))

  while (queue.length) {
    const curId = queue.shift()!
    const curPos = pos.get(curId)!
    const cur = byId.get(curId)!

    for (const conn of spec.connections) {
      let knownId: string, unknownId: string
      let knownWall: Wall, unknownWall: Wall
      let knownFrac: number, unknownFrac: number

      if (conn.roomIdA === curId && !visited.has(conn.roomIdB)) {
        knownId = conn.roomIdA; unknownId = conn.roomIdB
        knownWall = conn.wallA; unknownWall = conn.wallB
        knownFrac = conn.positionA; unknownFrac = conn.positionB
      } else if (conn.roomIdB === curId && !visited.has(conn.roomIdA)) {
        knownId = conn.roomIdB; unknownId = conn.roomIdA
        knownWall = conn.wallB; unknownWall = conn.wallA
        knownFrac = conn.positionB; unknownFrac = conn.positionA
      } else continue

      const knownRoom = byId.get(knownId)!
      const unknownRoom = byId.get(unknownId)!

      // Door centre in world space on the known room's wall edge
      let doorX: number, doorZ: number
      if (knownWall === 'north' || knownWall === 'south') {
        doorX = curPos.x + (knownFrac - 0.5) * knownRoom.floorWidth
        doorZ = knownWall === 'north'
          ? curPos.z - knownRoom.floorDepth / 2
          : curPos.z + knownRoom.floorDepth / 2
      } else {
        doorZ = curPos.z + (knownFrac - 0.5) * knownRoom.floorDepth
        doorX = knownWall === 'east'
          ? curPos.x + knownRoom.floorWidth / 2
          : curPos.x - knownRoom.floorWidth / 2
      }

      // Unknown room centre derived from where its wall meets the door
      let ux: number, uz: number
      if (unknownWall === 'north' || unknownWall === 'south') {
        ux = doorX - (unknownFrac - 0.5) * unknownRoom.floorWidth
        uz = unknownWall === 'south'
          ? doorZ - unknownRoom.floorDepth / 2
          : doorZ + unknownRoom.floorDepth / 2
      } else {
        uz = doorZ - (unknownFrac - 0.5) * unknownRoom.floorDepth
        ux = unknownWall === 'west'
          ? doorX + unknownRoom.floorWidth / 2
          : doorX - unknownRoom.floorWidth / 2
      }

      pos.set(unknownId, { x: ux, z: uz })
      visited.add(unknownId)
      queue.push(unknownId)
    }
  }

  return pos
}

// Returns the local id of the room whose floor AABB contains (x, z), or null.
// Room AABBs touch along shared walls — a position exactly on a boundary is
// considered inside both rooms; the first match wins.
export function getRoomAtPosition(
  spec: WorldSpec,
  positions: Map<string, RoomWorldPos>,
  x: number,
  z: number,
): string | null {
  for (const room of spec.rooms) {
    const p = positions.get(room.id)!
    if (Math.abs(x - p.x) <= room.floorWidth / 2 && Math.abs(z - p.z) <= room.floorDepth / 2) {
      return room.id
    }
  }
  return null
}

// Scoped room-id helpers. Every room in a world instance has a composite id of
// the form `{map_instance_id}_{room_id_from_map}`.
export function scopedRoomId(mapInstanceId: string, localRoomId: string): string {
  return `${mapInstanceId}_${localRoomId}`
}

export function unscopeRoomId(scopedId: string, mapInstanceId: string): string | null {
  const prefix = `${mapInstanceId}_`
  return scopedId.startsWith(prefix) ? scopedId.slice(prefix.length) : null
}

// AABB-overlap check between two rooms given their positions and sizes. Used
// at map build time to determine which rooms overlap in world-space
// coordinates (overlapping rooms are hidden by default on the client).
export function roomsOverlap(
  aPos: RoomWorldPos, aRoom: RoomSpec,
  bPos: RoomWorldPos, bRoom: RoomSpec,
): boolean {
  const gapX = Math.abs(aPos.x - bPos.x) - (aRoom.floorWidth  + bRoom.floorWidth)  / 2
  const gapZ = Math.abs(aPos.z - bPos.z) - (aRoom.floorDepth + bRoom.floorDepth) / 2
  return gapX < 0 && gapZ < 0
}

// Validates a WorldSpec after positions are computed. Throws on any violation.
// Enforces:
//   - every connection joins opposing walls (N↔S or E↔W)
//   - door opening fits within the wall span
//   - every room is reachable from rooms[0] via connections
//   - every geometry entry fits inside its room's bounding cube
// Note: rooms may overlap — `buildMapInstanceArtifacts` tracks overlaps in
// `overlapSet` and the client renderer hides overlapping rooms that aren't
// the viewer's current room, so per-player sub-rooms can coexist safely.
export function validateWorldSpec(spec: WorldSpec, positions: Map<string, RoomWorldPos>): void {
  const byId = new Map(spec.rooms.map(r => [r.id, r]))

  for (const conn of spec.connections) {
    const opposing =
      (conn.wallA === 'north' && conn.wallB === 'south') ||
      (conn.wallA === 'south' && conn.wallB === 'north') ||
      (conn.wallA === 'east'  && conn.wallB === 'west')  ||
      (conn.wallA === 'west'  && conn.wallB === 'east')
    if (!opposing) {
      throw new Error(
        `Connection ${conn.roomIdA}:${conn.wallA} ↔ ${conn.roomIdB}:${conn.wallB} must join opposing walls (N↔S or E↔W)`
      )
    }

    for (const [roomId, wall, frac] of [
      [conn.roomIdA, conn.wallA, conn.positionA],
      [conn.roomIdB, conn.wallB, conn.positionB],
    ] as [string, Wall, number][]) {
      const room = byId.get(roomId)!
      const wallLen = (wall === 'north' || wall === 'south') ? room.floorWidth : room.floorDepth
      const centre = (frac - 0.5) * wallLen
      if (centre - conn.width / 2 < -wallLen / 2 || centre + conn.width / 2 > wallLen / 2) {
        throw new Error(`Door on ${roomId}:${wall} extends past wall bounds`)
      }
    }
  }

  // Overlapping rooms are allowed: `buildMapInstanceArtifacts` records each
  // overlap pair in `overlapSet`, and the client renderer hides overlapping
  // rooms that are not the player's current room. Scenarios use this to
  // spawn per-player rooms that geometrically overlap but are only visible
  // to their respective occupant.

  for (const room of spec.rooms) {
    if (!positions.has(room.id)) {
      throw new Error(`Room '${room.id}' is not reachable from rooms[0] via connections`)
    }
  }

  for (const room of spec.rooms) {
    const items = room.geometry ?? []
    for (const g of items) validateGeometryInRoom(room, g)
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j]
        if (geometryBoxesOverlap(a, b)) {
          throw new Error(
            `Geometry '${a.id}' and '${b.id}' in room '${room.id}' overlap`
          )
        }
      }
    }
  }
}

function validateGeometryInRoom(room: RoomSpec, g: GeometrySpec): void {
  const hx = g.width  / 2
  const hy = g.height / 2
  const hz = g.depth  / 2
  const outX = Math.abs(g.cx) + hx > room.floorWidth  / 2 + 1e-9
  const outZ = Math.abs(g.cz) + hz > room.floorDepth / 2 + 1e-9
  const outYLow  = g.cy - hy < -1e-9
  const outYHigh = g.cy + hy > room.height + 1e-9
  if (outX || outZ || outYLow || outYHigh) {
    throw new Error(
      `Geometry '${g.id}' in room '${room.id}' extends outside room cube`
      + ` (floor ${room.floorWidth}×${room.floorDepth}, height ${room.height})`
    )
  }
}

// Strict 3D-AABB overlap: boxes that merely touch on a face (`gap === 0`) do
// not overlap — only positive interpenetration counts.
function geometryBoxesOverlap(a: GeometrySpec, b: GeometrySpec): boolean {
  const gapX = Math.abs(a.cx - b.cx) - (a.width  + b.width)  / 2
  const gapY = Math.abs(a.cy - b.cy) - (a.height + b.height) / 2
  const gapZ = Math.abs(a.cz - b.cz) - (a.depth  + b.depth)  / 2
  return gapX < -1e-9 && gapY < -1e-9 && gapZ < -1e-9
}
