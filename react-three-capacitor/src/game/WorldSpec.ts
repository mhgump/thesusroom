// ── Migration notes (Task 1: data-shape only) ────────────────────────────────
// The RoomConnection shape was migrated to the user-spec target:
//   { roomIdA, roomIdB,
//     room1: { wall, length, position, transitionRegion },
//     room2: { wall, length, position, transitionRegion } }
//
// Decisions:
//   1. roomIdA / roomIdB are kept as siblings of room1 / room2. The user's
//      literal spec was `{ room1: {...}, room2: {...} }` with no room ids,
//      but a connection has to reference rooms somehow. Keeping them as
//      sibling fields (rather than nesting them inside room1/room2) is the
//      pragmatic choice — it preserves the "A vs B" symmetry the BFS uses
//      and matches how every author callsite refers to them today.
//   2. position (the door offset along the wall, 0..1 fraction): added
//      *inside* each `room1`/`room2` sub-object. The previous shape
//      authored `positionA` / `positionB` at the connection root; many
//      maps use non-centered doors (scenario1 attaches sub-rooms at
//      x positions derived from the cell circle x), so the field must
//      survive the migration. Defaults to 0.5 (centered) when omitted.
//   3. transitionRegion: 'none' | 'toEdge', defaults to 'none'. Camera
//      transition zones are no longer authored as a polygon on the
//      connection (the previous `cameraTransition.corners` field is
//      dropped). Task 4 will synthesize the zone polygon at runtime
//      from `transitionRegion`; for this task,
//      `buildCameraConstraintShapes` emits NO transition zones (it only
//      emits per-room camera rects). The camera will still clamp to
//      per-room rects — just without inter-room bridges until Task 4.
//   4. width → length: the field is renamed to `length` per the user
//      spec narrative. Same units (world units), same meaning (the door
//      opening size); both `room1.length` and `room2.length` should be
//      equal for a well-formed connection (validateWorldSpec checks the
//      door fits inside both walls' spans).

import type { GeometrySpec, RoomSpec, Wall } from './RoomSpec.js'

// The kind of camera transition a connection has. Replaces the previous
// `cameraTransition.corners` polygon authoring — Task 4 will synthesize
// the polygon at runtime from this enum.
export type TransitionRegion = 'none' | 'toEdge'

// One side of a connection. `wall` is the wall the door punches through;
// `length` is the door opening size in world units; `position` is the
// 0..1 fraction along the wall (N/S = fraction of `floorWidthX`, west→east;
// E/W = fraction of `floorDepthY`, north→south); `transitionRegion`
// describes how the camera bridges into this side (Task 4 reads it).
export interface RoomConnectionSide {
  wall: Wall
  length: number
  position: number
  transitionRegion: TransitionRegion
}

// A doorway between two rooms. See top-of-file comment for migration notes.
//
// Connections are still the *sole* source of both physical adjacency (which
// rooms a player may walk between) and the world-space placement of rooms
// when the rooms don't pin themselves with explicit `x`/`y`: a BFS over
// `connections` starting at `rooms[0]` (placed at origin) assigns each room
// a world-space centre.
export interface RoomConnection {
  roomIdA: string
  roomIdB: string
  room1: RoomConnectionSide
  room2: RoomConnectionSide
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
// (validateWorldSpec rejects this). Rooms with explicit `x`/`y` on their
// RoomSpec override the BFS-derived position for that node (they're treated
// as authored anchors).
export function computeRoomPositions(spec: WorldSpec): Map<string, RoomWorldPos> {
  const pos = new Map<string, RoomWorldPos>()
  if (!spec.rooms.length) return pos

  const origin = spec.origin ?? { x: 0, z: 0 }
  const root = spec.rooms[0]
  pos.set(root.id, roomAnchorOrFallback(root, { x: origin.x, z: origin.z }))
  const visited = new Set([root.id])
  const queue = [root.id]
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
        knownWall = conn.room1.wall; unknownWall = conn.room2.wall
        knownFrac = conn.room1.position; unknownFrac = conn.room2.position
      } else if (conn.roomIdB === curId && !visited.has(conn.roomIdA)) {
        knownId = conn.roomIdB; unknownId = conn.roomIdA
        knownWall = conn.room2.wall; unknownWall = conn.room1.wall
        knownFrac = conn.room2.position; unknownFrac = conn.room1.position
      } else continue

      const knownRoom = byId.get(knownId)!
      const unknownRoom = byId.get(unknownId)!

      // Door centre in world space on the known room's wall edge
      let doorX: number, doorZ: number
      if (knownWall === 'north' || knownWall === 'south') {
        doorX = curPos.x + (knownFrac - 0.5) * knownRoom.floorWidthX
        doorZ = knownWall === 'north'
          ? curPos.z - knownRoom.floorDepthY / 2
          : curPos.z + knownRoom.floorDepthY / 2
      } else {
        doorZ = curPos.z + (knownFrac - 0.5) * knownRoom.floorDepthY
        doorX = knownWall === 'east'
          ? curPos.x + knownRoom.floorWidthX / 2
          : curPos.x - knownRoom.floorWidthX / 2
      }

      // Unknown room centre derived from where its wall meets the door
      let ux: number, uz: number
      if (unknownWall === 'north' || unknownWall === 'south') {
        ux = doorX - (unknownFrac - 0.5) * unknownRoom.floorWidthX
        uz = unknownWall === 'south'
          ? doorZ - unknownRoom.floorDepthY / 2
          : doorZ + unknownRoom.floorDepthY / 2
      } else {
        uz = doorZ - (unknownFrac - 0.5) * unknownRoom.floorDepthY
        ux = unknownWall === 'west'
          ? doorX + unknownRoom.floorWidthX / 2
          : doorX - unknownRoom.floorWidthX / 2
      }

      pos.set(unknownId, roomAnchorOrFallback(unknownRoom, { x: ux, z: uz }))
      visited.add(unknownId)
      queue.push(unknownId)
    }
  }

  return pos
}

// If a room declares an explicit `x`/`y`, those override BFS-derived
// coordinates. Otherwise we fall through to the supplied fallback. This is
// applied at every node visit so the root *and* every descendant can pin
// themselves.
function roomAnchorOrFallback(room: RoomSpec, fallback: RoomWorldPos): RoomWorldPos {
  if (room.x !== undefined && room.y !== undefined) return { x: room.x, z: room.y }
  return fallback
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
    if (Math.abs(x - p.x) <= room.floorWidthX / 2 && Math.abs(z - p.z) <= room.floorDepthY / 2) {
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
  const gapX = Math.abs(aPos.x - bPos.x) - (aRoom.floorWidthX  + bRoom.floorWidthX)  / 2
  const gapZ = Math.abs(aPos.z - bPos.z) - (aRoom.floorDepthY + bRoom.floorDepthY) / 2
  return gapX < 0 && gapZ < 0
}

// Validates a WorldSpec after positions are computed. Throws on any violation.
// Enforces:
//   - every connection joins opposing walls (N↔S or E↔W)
//   - door opening fits within the wall span
//   - both sides of a connection agree on the door length
//   - every room is reachable from rooms[0] via connections
//   - every geometry entry fits inside its room's bounding cube
// Note: rooms may overlap — `buildMapInstanceArtifacts` tracks overlaps in
// `overlapSet` and the client renderer hides overlapping rooms that aren't
// the viewer's current room, so per-player sub-rooms can coexist safely.
export function validateWorldSpec(spec: WorldSpec, positions: Map<string, RoomWorldPos>): void {
  const byId = new Map(spec.rooms.map(r => [r.id, r]))

  for (const conn of spec.connections) {
    const wallA = conn.room1.wall
    const wallB = conn.room2.wall
    const opposing =
      (wallA === 'north' && wallB === 'south') ||
      (wallA === 'south' && wallB === 'north') ||
      (wallA === 'east'  && wallB === 'west')  ||
      (wallA === 'west'  && wallB === 'east')
    if (!opposing) {
      throw new Error(
        `Connection ${conn.roomIdA}:${wallA} ↔ ${conn.roomIdB}:${wallB} must join opposing walls (N↔S or E↔W)`
      )
    }

    if (Math.abs(conn.room1.length - conn.room2.length) > 1e-9) {
      throw new Error(
        `Connection ${conn.roomIdA} ↔ ${conn.roomIdB} length mismatch: room1=${conn.room1.length} room2=${conn.room2.length}`
      )
    }

    for (const [roomId, side] of [
      [conn.roomIdA, conn.room1],
      [conn.roomIdB, conn.room2],
    ] as [string, RoomConnectionSide][]) {
      const room = byId.get(roomId)!
      const wallLen = (side.wall === 'north' || side.wall === 'south') ? room.floorWidthX : room.floorDepthY
      const centre = (side.position - 0.5) * wallLen
      if (centre - side.length / 2 < -wallLen / 2 || centre + side.length / 2 > wallLen / 2) {
        throw new Error(`Door on ${roomId}:${side.wall} extends past wall bounds`)
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
  const outX = Math.abs(g.cx) + hx > room.floorWidthX  / 2 + 1e-9
  const outZ = Math.abs(g.cz) + hz > room.floorDepthY / 2 + 1e-9
  const outYLow  = g.cy - hy < -1e-9
  const outYHigh = g.cy + hy > room.height + 1e-9
  if (outX || outZ || outYLow || outYHigh) {
    throw new Error(
      `Geometry '${g.id}' in room '${room.id}' extends outside room cube`
      + ` (floor ${room.floorWidthX}×${room.floorDepthY}, height ${room.height})`
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
