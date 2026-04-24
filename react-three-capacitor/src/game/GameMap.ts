import type { WorldSpec, WalkableArea, RoomWorldPos } from './WorldSpec.js'
import type { CameraConstraintShapes } from './CameraConstraint.js'
import type { PhysicsSpec } from './World.js'
import type { GameSpec } from './GameSpec.js'
import type { NpcSpec } from './NpcSpec.js'

// A GameMap is a static map definition; a world instance instantiates it under
// a `mapInstanceId` to produce scoped room ids of the form
// `{mapInstanceId}_{localRoomId}`. All room ids that cross the wire (scenario
// callbacks, client store state, server → client messages) use the scoped form.
export interface GameMap {
  id: string
  // The map instance id used to scope room ids. For the current deployment
  // (one world, one map instance) this is equal to `id`.
  mapInstanceId: string
  // Client rendering
  worldSpec: WorldSpec
  // Scoped-id keyed map from scoped room id → world-space room centre.
  roomPositions: Map<string, RoomWorldPos>
  cameraShapes: CameraConstraintShapes
  // Returns a scoped room id for the containing room, or null.
  getRoomAtPosition: (x: number, z: number) => string | null
  // Returns the scoped room ids adjacent to the given scoped room id per the
  // map's default adjacency table (used for default rendering visibility).
  getAdjacentRoomIds: (scopedRoomId: string) => string[]
  // Returns true when the given scoped room id shares any world-space floor
  // area with another room in the world. Overlapping rooms are hidden by
  // default on the client unless the player is inside them or the server has
  // explicitly toggled them visible for that player.
  isRoomOverlapping: (scopedRoomId: string) => boolean
  // Physics & walkability
  walkable: WalkableArea
  physics?: PhysicsSpec
  walkableVariants?: Array<{ triggerIds: string[]; walkable: WalkableArea }>
  toggleVariants?: Array<{ triggerIds: string[]; toggleIds: string[] }>
  // Game content
  gameSpec: GameSpec
  npcs: NpcSpec[]
}
