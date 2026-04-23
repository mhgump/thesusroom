import type { WorldSpec, WalkableArea, RoomWorldPos } from './WorldSpec.js'
import type { CameraConstraintShapes } from './CameraConstraint.js'
import type { PhysicsSpec } from './World.js'
import type { GameSpec } from './GameSpec.js'
import type { NpcSpec } from './NpcSpec.js'

export interface GameMap {
  id: string
  // Client rendering
  worldSpec: WorldSpec
  roomPositions: Map<string, RoomWorldPos>
  cameraShapes: CameraConstraintShapes
  getRoomAtPosition: (x: number, z: number) => string | null
  // Physics & walkability
  walkable: WalkableArea
  physics?: PhysicsSpec
  walkableVariants?: Array<{ triggerIds: string[]; walkable: WalkableArea }>
  toggleVariants?: Array<{ triggerIds: string[]; toggleIds: string[] }>
  // Game content
  gameSpec: GameSpec
  npcs: NpcSpec[]
}
