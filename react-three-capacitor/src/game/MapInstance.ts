import {
  computeRoomPositions,
  getRoomAtPosition as getLocalRoomAtPosition,
  scopedRoomId,
  unscopeRoomId,
  roomsOverlap,
  type RoomWorldPos,
  type WorldSpec,
} from './WorldSpec.js'

// Given a WorldSpec (authored with local room ids) and a map instance id,
// computes the scoped-id derived artifacts a GameMap needs to expose:
//   - roomPositions keyed by scoped ids
//   - getRoomAtPosition returning scoped ids
//   - getAdjacentRoomIds returning scoped ids
//   - isRoomOverlapping for each scoped id
//
// A single map instance never overlaps itself (validateWorldSpec guarantees
// this), so isRoomOverlapping always returns false for a map built in
// isolation. Multi-map-instance worlds recompute this set when adding
// additional map instances.
export interface MapInstanceArtifacts {
  roomPositions: Map<string, RoomWorldPos>
  getRoomAtPosition: (x: number, z: number) => string | null
  getAdjacentRoomIds: (scopedId: string) => string[]
  isRoomOverlapping: (scopedId: string) => boolean
  scopedRoomIds: string[]
}

export function buildMapInstanceArtifacts(
  spec: WorldSpec,
  mapInstanceId: string,
): MapInstanceArtifacts {
  const localPositions = computeRoomPositions(spec)
  const scopedPositions = new Map<string, RoomWorldPos>()
  for (const [localId, p] of localPositions) {
    scopedPositions.set(scopedRoomId(mapInstanceId, localId), p)
  }

  const scopedAdjacency = new Map<string, string[]>()
  for (const [localId, neighbours] of Object.entries(spec.visibility ?? {})) {
    scopedAdjacency.set(
      scopedRoomId(mapInstanceId, localId),
      neighbours.map(n => scopedRoomId(mapInstanceId, n)),
    )
  }

  const overlapSet = new Set<string>()
  for (let i = 0; i < spec.rooms.length; i++) {
    for (let j = i + 1; j < spec.rooms.length; j++) {
      const a = spec.rooms[i], b = spec.rooms[j]
      const pa = localPositions.get(a.id)!, pb = localPositions.get(b.id)!
      if (roomsOverlap(pa, a, pb, b)) {
        overlapSet.add(scopedRoomId(mapInstanceId, a.id))
        overlapSet.add(scopedRoomId(mapInstanceId, b.id))
      }
    }
  }

  return {
    roomPositions: scopedPositions,
    getRoomAtPosition(x: number, z: number): string | null {
      const localId = getLocalRoomAtPosition(spec, localPositions, x, z)
      return localId === null ? null : scopedRoomId(mapInstanceId, localId)
    },
    getAdjacentRoomIds(scopedId: string): string[] {
      return scopedAdjacency.get(scopedId) ?? []
    },
    isRoomOverlapping(scopedId: string): boolean {
      return overlapSet.has(scopedId)
    },
    scopedRoomIds: spec.rooms.map(r => scopedRoomId(mapInstanceId, r.id)),
  }
}

export { scopedRoomId, unscopeRoomId }
