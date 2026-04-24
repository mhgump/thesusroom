import type { WorldSpec, WalkableArea, RoomWorldPos } from '../../../react-three-capacitor/src/game/WorldSpec'
import type { CameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint'
import type { GameSpec } from '../../../react-three-capacitor/src/game/GameSpec'
import type { PhysicsSpec } from '../../../react-three-capacitor/src/game/World'

export interface ClientMap {
  worldSpec: WorldSpec
  roomPositions: Map<string, RoomWorldPos>
  cameraShapes: CameraConstraintShapes
  walkable: WalkableArea
  physics?: PhysicsSpec
  gameSpec: GameSpec
  getRoomAtPosition: (x: number, z: number) => string
  walkableVariants?: Array<{ triggerIds: string[]; walkable: WalkableArea }>
}

// Re-export the canonical module's parse — this file predates the shared
// parser and is kept only so legacy importers of `../registry` keep working.
export { CURRENT_SCENARIO_ID } from '../../maps/index.js'
