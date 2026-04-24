import { computeRoomPositions, type RoomConnection, type RoomWorldPos } from './WorldSpec.js'
import type { RoomSpec } from './RoomSpec.js'
import { buildCameraConstraintShapes, type CameraConstraintShapes } from './CameraConstraint.js'
import type { InstructionEventSpec, VoteRegionSpec, ButtonSpec } from './GameSpec.js'
import type { NpcSpec } from './NpcSpec.js'
import { buildMapInstanceArtifacts, scopedRoomId } from './MapInstance.js'

// A GameMap is a static map definition; a world instance instantiates it under
// a `mapInstanceId` to produce scoped room ids of the form
// `{mapInstanceId}_{localRoomId}`. All room ids that cross the wire (scenario
// callbacks, client store state, server → client messages) use the scoped form.
//
// Every piece of geometry in the map — walls, obstacles, toggleable doors,
// floor decorations — is authored as a per-room GeometrySpec on the owning
// RoomSpec. There is no separate `physics` / `walkable` / `walkableVariants`
// concept: Rapier treats each GeometrySpec as a solid XZ-projected collider
// and the World enforces "stay in rooms" by checking the player's post-move
// position against the AABB union of the player's currently accessible rooms.
//
// All map-authored content lives flat on this interface. There is no
// intermediate `worldSpec` / `gameSpec` aggregation — the rooms + connections
// + buttons + vote regions + instruction strings are top-level map fields.
export interface GameMap {
  id: string
  // The map instance id used to scope room ids. For the current deployment
  // (one world, one map instance) this is equal to `id`.
  mapInstanceId: string

  // ── Room topology ────────────────────────────────────────────────────────
  rooms: RoomSpec[]
  // Connections are the *sole* source of both physical adjacency (which rooms
  // a player may walk between) and the world-space placement of rooms: a BFS
  // over `connections` starting at `rooms[0]` (placed at `origin`) assigns
  // each room a world-space centre.
  connections: RoomConnection[]
  // Optional world-space anchor for rooms[0]. When omitted, rooms[0] is
  // placed at the world origin.
  origin?: RoomWorldPos

  // ── Map-authored gameplay content ────────────────────────────────────────
  instructionSpecs: InstructionEventSpec[]
  voteRegions: VoteRegionSpec[]
  buttons?: ButtonSpec[]

  // ── Derived artifacts (built once via MapInstance.buildMapInstanceArtifacts) ─
  // Scoped-id keyed map from scoped room id → world-space room centre.
  roomPositions: Map<string, RoomWorldPos>
  cameraShapes: CameraConstraintShapes
  // Returns a scoped room id for the containing room, or null.
  getRoomAtPosition: (x: number, z: number) => string | null
  // Returns the scoped room ids adjacent to the given scoped room id per the
  // map's default connections (the physical topology — symmetric). Scenarios
  // may enable/disable individual connections at runtime via the World API.
  getAdjacentRoomIds: (scopedRoomId: string) => string[]
  // Returns true when the given scoped room id shares any world-space floor
  // area with another room in the world. Overlapping rooms are hidden by
  // default on the client unless the player is inside them or the server has
  // explicitly toggled them visible for that player.
  isRoomOverlapping: (scopedRoomId: string) => boolean

  // ── NPCs ─────────────────────────────────────────────────────────────────
  npcs: NpcSpec[]
}

// Wire-safe subset of a GameMap: topology + authored content only, no derived
// artifacts (roomPositions / cameraShapes / lookup functions). The client
// rebuilds those via `reifyGameMap` after receiving the map over the wire.
export interface SerializedMap {
  id: string
  mapInstanceId: string
  origin?: RoomWorldPos
  rooms: RoomSpec[]
  connections: RoomConnection[]
  voteRegions: VoteRegionSpec[]
  buttons?: ButtonSpec[]
  npcs: NpcSpec[]
  instructionSpecs: InstructionEventSpec[]
}

export function serializeGameMap(map: GameMap): SerializedMap {
  return {
    id: map.id,
    mapInstanceId: map.mapInstanceId,
    origin: map.origin,
    rooms: map.rooms,
    connections: map.connections,
    voteRegions: map.voteRegions,
    buttons: map.buttons,
    npcs: map.npcs,
    instructionSpecs: map.instructionSpecs,
  }
}

// Rebuild a full GameMap from the wire form by recomputing every derived
// artifact (roomPositions, cameraShapes, lookup functions). The client calls
// this on every map received in a `world_reset` or `map_add` message.
export function reifyGameMap(serialized: SerializedMap): GameMap {
  const topology = { rooms: serialized.rooms, connections: serialized.connections, origin: serialized.origin }
  const localPositions = computeRoomPositions(topology)
  const artifacts = buildMapInstanceArtifacts(topology, serialized.mapInstanceId)
  const cameraShapes = buildCameraConstraintShapes(topology, localPositions)
  return {
    id: serialized.id,
    mapInstanceId: serialized.mapInstanceId,
    origin: serialized.origin,
    rooms: serialized.rooms,
    connections: serialized.connections,
    voteRegions: serialized.voteRegions,
    buttons: serialized.buttons,
    npcs: serialized.npcs,
    instructionSpecs: serialized.instructionSpecs,
    roomPositions: artifacts.roomPositions,
    cameraShapes,
    getRoomAtPosition: artifacts.getRoomAtPosition,
    getAdjacentRoomIds: artifacts.getAdjacentRoomIds,
    isRoomOverlapping: artifacts.isRoomOverlapping,
  }
}

export { scopedRoomId }
