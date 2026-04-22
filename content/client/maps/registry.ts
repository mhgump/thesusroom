import type { WorldSpec, WalkableArea, RoomWorldPos } from '../../../react-three-capacitor/src/game/WorldSpec'
import type { CameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint'
import type { GameSpec } from '../../../react-three-capacitor/src/game/GameSpec'

export interface ClientMap {
  worldSpec: WorldSpec
  roomPositions: Map<string, RoomWorldPos>
  cameraShapes: CameraConstraintShapes
  walkable: WalkableArea
  gameSpec: GameSpec
  getRoomAtPosition: (x: number, z: number) => string
  walkableVariants?: Array<{ triggerIds: string[]; walkable: WalkableArea }>
}

// Computed once at module load from the page URL — stable for the session.
export const CURRENT_SCENARIO_ID: string =
  typeof window !== 'undefined'
    ? window.location.pathname.replace(/^\/+/, '') || 'demo'
    : 'demo'
