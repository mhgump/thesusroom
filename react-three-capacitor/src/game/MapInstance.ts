import {
  computeRoomPositions,
  getRoomAtPosition as getLocalRoomAtPosition,
  scopedRoomId,
  unscopeRoomId,
  roomsOverlap,
  type RoomWorldPos,
  type WorldSpec,
} from './WorldSpec.js'
import type { RoomBounds } from './World.js'

// Flat global-coord XZ projection of a single geometry piece, as needed by
// Rapier when constructing a fixed-body cuboid collider. `roomId` is the
// scoped id of the owning room — the World uses it to gate collisions per
// player when a room is toggled off.
export interface FlattenedGeometry {
  id: string
  roomId: string
  cx: number
  cz: number
  hw: number
  hd: number
}

// Artifacts derived from a WorldSpec + mapInstanceId. Covers three consumers:
//   - The World itself: scoped room ids, room AABBs, flattened geometry (for
//     Rapier collider creation), default adjacency.
//   - GameMap callers: scoped `getRoomAtPosition` / `getAdjacentRoomIds` /
//     `isRoomOverlapping` / `roomPositions` for rendering and lookup.
export interface MapInstanceArtifacts {
  scopedRoomIds: string[]
  roomBounds: Map<string, RoomBounds>
  geometry: FlattenedGeometry[]
  adjacency: Map<string, string[]>
  roomPositions: Map<string, RoomWorldPos>
  getRoomAtPosition: (x: number, z: number) => string | null
  getAdjacentRoomIds: (scopedId: string) => string[]
  isRoomOverlapping: (scopedId: string) => boolean
}

export function buildMapInstanceArtifacts(
  spec: WorldSpec,
  mapInstanceId: string,
): MapInstanceArtifacts {
  const localPositions = computeRoomPositions(spec)

  const scopedPositions = new Map<string, RoomWorldPos>()
  const roomBounds = new Map<string, RoomBounds>()
  for (const room of spec.rooms) {
    const p = localPositions.get(room.id)
    if (!p) continue
    const scopedId = scopedRoomId(mapInstanceId, room.id)
    scopedPositions.set(scopedId, p)
    roomBounds.set(scopedId, {
      cx: p.x,
      cz: p.z,
      hw: room.floorWidthX / 2,
      hd: room.floorDepthY / 2,
    })
  }

  // Flatten per-room geometry to global coords. Every piece gets a scoped id
  // of the form `{mapInstanceId}_{roomId}_{geomId}` to keep ids unique across
  // multiple map instances in a world. (Authors reference geometry by the
  // same scoped id when toggling — scenarios own the scoping convention.)
  const geometry: FlattenedGeometry[] = []
  for (const room of spec.rooms) {
    const p = localPositions.get(room.id)
    if (!p) continue
    const scopedId = scopedRoomId(mapInstanceId, room.id)
    for (const g of room.geometry ?? []) {
      geometry.push({
        id: g.id,
        roomId: scopedId,
        cx: p.x + g.cx,
        cz: p.z + g.cz,
        hw: g.width  / 2,
        hd: g.depth  / 2,
      })
    }
  }

  // Symmetric adjacency derived from the spec's connections list.
  const adjacency = new Map<string, string[]>()
  const addEdge = (a: string, b: string) => {
    const list = adjacency.get(a) ?? []
    if (!list.includes(b)) list.push(b)
    adjacency.set(a, list)
  }
  for (const conn of spec.connections) {
    const a = scopedRoomId(mapInstanceId, conn.roomIdA)
    const b = scopedRoomId(mapInstanceId, conn.roomIdB)
    addEdge(a, b)
    addEdge(b, a)
  }

  const overlapSet = new Set<string>()
  for (let i = 0; i < spec.rooms.length; i++) {
    for (let j = i + 1; j < spec.rooms.length; j++) {
      const a = spec.rooms[i], b = spec.rooms[j]
      const pa = localPositions.get(a.id), pb = localPositions.get(b.id)
      if (!pa || !pb) continue
      if (roomsOverlap(pa, a, pb, b)) {
        overlapSet.add(scopedRoomId(mapInstanceId, a.id))
        overlapSet.add(scopedRoomId(mapInstanceId, b.id))
      }
    }
  }

  return {
    scopedRoomIds: spec.rooms.map(r => scopedRoomId(mapInstanceId, r.id)),
    roomBounds,
    geometry,
    adjacency,
    roomPositions: scopedPositions,
    getRoomAtPosition(x: number, z: number): string | null {
      const localId = getLocalRoomAtPosition(spec, localPositions, x, z)
      return localId === null ? null : scopedRoomId(mapInstanceId, localId)
    },
    getAdjacentRoomIds(scopedId: string): string[] {
      return adjacency.get(scopedId) ?? []
    },
    isRoomOverlapping(scopedId: string): boolean {
      return overlapSet.has(scopedId)
    },
  }
}

export { scopedRoomId, unscopeRoomId }
