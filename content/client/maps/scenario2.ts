import type { WorldSpec } from '../../../react-three-capacitor/src/game/WorldSpec'
import type { GameSpec } from '../../../react-three-capacitor/src/game/GameSpec'
import type { ClientMap } from './registry'
import { computeRoomPositions, computeWalkableArea, getRoomAtPosition, validateWorldSpec } from '../../../react-three-capacitor/src/game/WorldSpec'
import { buildCameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint'

const CAPSULE_RADIUS = 0.0282

export const S2_WORLD_SPEC: WorldSpec = {
  rooms: [
    {
      id: 'main', name: 'Scenario 2',
      floorWidth: 1.6112,
      floorDepth: 1.0,
      barrierHeight: 0.0242, barrierThickness: 0.0242,
      cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
    },
  ],
  connections: [],
  visibility: { main: [] },
}

export const S2_ROOM_POSITIONS = computeRoomPositions(S2_WORLD_SPEC)
validateWorldSpec(S2_WORLD_SPEC, S2_ROOM_POSITIONS)
export const S2_WALKABLE = computeWalkableArea(S2_WORLD_SPEC, S2_ROOM_POSITIONS, CAPSULE_RADIUS)
export const S2_CAMERA_SHAPES = buildCameraConstraintShapes(S2_WORLD_SPEC, S2_ROOM_POSITIONS)

function getS2RoomAtPosition(x: number, z: number): string {
  return getRoomAtPosition(S2_WORLD_SPEC, S2_ROOM_POSITIONS, x, z) ?? S2_WORLD_SPEC.rooms[0].id
}

// Vote positions matching content/server/maps/scenario2.ts
const GRID_X = 0.4028
const GRID_Z = 0.25
const VOTE_R = 0.1450

export const S2_GAME_SPEC: GameSpec = {
  instructionSpecs: [],
  voteRegions: [
    { id: 's2_v1', label: 'A', color: '#e74c3c', x: -GRID_X, z: -GRID_Z, radius: VOTE_R },
    { id: 's2_v2', label: 'B', color: '#3498db', x: +GRID_X, z: -GRID_Z, radius: VOTE_R },
    { id: 's2_v3', label: 'C', color: '#2ecc71', x: -GRID_X, z: +GRID_Z, radius: VOTE_R },
    { id: 's2_v4', label: 'D', color: '#f1c40f', x: +GRID_X, z: +GRID_Z, radius: VOTE_R },
  ],
  geometry: [],
}

export const SCENARIO2_CLIENT_MAP: ClientMap = {
  worldSpec: S2_WORLD_SPEC,
  roomPositions: S2_ROOM_POSITIONS,
  cameraShapes: S2_CAMERA_SHAPES,
  walkable: S2_WALKABLE,
  gameSpec: S2_GAME_SPEC,
  getRoomAtPosition: getS2RoomAtPosition,
}
