import type { RoomSpec, Wall } from './RoomSpec.js'

// Walkable area for physics — precomputed rects, already inset by capsule radius.
export interface WalkableRect { cx: number; cz: number; hw: number; hd: number }
export interface WalkableArea { rects: WalkableRect[] }

// A doorway between two rooms.
// positionA/B: 0..1 along the wall (N/S = fraction of floorWidth; E/W = fraction of floorDepth)
// width: opening width in world units
// cameraTransition: designer-specified convex polygon (3–4 corners) bridging the two rooms'
//   camera rects. Corners are in room A's local coordinate frame (add room A's world position
//   to convert to world space). Omit only when the two camera rects share a boundary with no gap.
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

// visibility: roomId → adjacent room IDs rendered when player is in that room
export interface WorldSpec {
  rooms: RoomSpec[]
  connections: RoomConnection[]
  visibility: Record<string, string[]>
}

export interface RoomWorldPos { x: number; z: number }

// BFS from rooms[0] (placed at origin) to derive world-space centers for all rooms.
export function computeRoomPositions(spec: WorldSpec): Map<string, RoomWorldPos> {
  const pos = new Map<string, RoomWorldPos>()
  if (!spec.rooms.length) return pos

  pos.set(spec.rooms[0].id, { x: 0, z: 0 })
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

      // Door center in world space on the known room's wall edge
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

      // Unknown room center derived from where its wall meets the door
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

// Precompute walkable area from spec. capsuleRadius is inset from all edges.
export function computeWalkableArea(
  spec: WorldSpec,
  positions: Map<string, RoomWorldPos>,
  capsuleRadius: number,
): WalkableArea {
  const rects: WalkableRect[] = []
  const byId = new Map(spec.rooms.map(r => [r.id, r]))

  for (const room of spec.rooms) {
    const p = positions.get(room.id)!
    rects.push({
      cx: p.x, cz: p.z,
      hw: room.floorWidth / 2 - capsuleRadius,
      hd: room.floorDepth / 2 - capsuleRadius,
    })
  }

  // Thin corridor at each shared floor edge so the capsule can cross between rooms
  for (const conn of spec.connections) {
    const halfDoor = conn.width / 2 - capsuleRadius
    if (halfDoor <= 0) continue

    const posA = positions.get(conn.roomIdA)!
    const roomA = byId.get(conn.roomIdA)!

    let cx: number, cz: number, hw: number, hd: number
    if (conn.wallA === 'north' || conn.wallA === 'south') {
      cx = posA.x + (conn.positionA - 0.5) * roomA.floorWidth
      cz = conn.wallA === 'north'
        ? posA.z - roomA.floorDepth / 2
        : posA.z + roomA.floorDepth / 2
      hw = halfDoor; hd = capsuleRadius
    } else {
      cz = posA.z + (conn.positionA - 0.5) * roomA.floorDepth
      cx = conn.wallA === 'east'
        ? posA.x + roomA.floorWidth / 2
        : posA.x - roomA.floorWidth / 2
      hw = capsuleRadius; hd = halfDoor
    }

    rects.push({ cx, cz, hw, hd })
  }

  return { rects }
}

// Returns the local id of the room whose floor contains (x, z), or null.
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
// at map build time to determine which rooms overlap in world-space coordinates
// (overlapping rooms are hidden by default on the client).
export function roomsOverlap(
  aPos: RoomWorldPos, aRoom: RoomSpec,
  bPos: RoomWorldPos, bRoom: RoomSpec,
): boolean {
  const gapX = Math.abs(aPos.x - bPos.x) - (aRoom.floorWidth  + bRoom.floorWidth)  / 2
  const gapZ = Math.abs(aPos.z - bPos.z) - (aRoom.floorDepth + bRoom.floorDepth) / 2
  return gapX < 0 && gapZ < 0
}

// Validates a WorldSpec after positions are computed. Throws on any violation.
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
      const center = (frac - 0.5) * wallLen
      if (center - conn.width / 2 < -wallLen / 2 || center + conn.width / 2 > wallLen / 2) {
        throw new Error(`Door on ${roomId}:${wall} extends past wall bounds`)
      }
    }
  }

  const rooms = spec.rooms
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j]
      const pa = positions.get(a.id)!, pb = positions.get(b.id)!
      const gapX = Math.abs(pa.x - pb.x) - (a.floorWidth  + b.floorWidth)  / 2
      const gapZ = Math.abs(pa.z - pb.z) - (a.floorDepth + b.floorDepth) / 2
      if (gapX < 0 && gapZ < 0) {
        throw new Error(
          `Rooms ${a.id} and ${b.id} overlap (gapX=${gapX.toFixed(3)}, gapZ=${gapZ.toFixed(3)})`
        )
      }
    }
  }
}
