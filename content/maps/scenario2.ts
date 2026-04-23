import type { WorldSpec } from '../../react-three-capacitor/src/game/WorldSpec.js'
import type { GameSpec } from '../../react-three-capacitor/src/game/GameSpec.js'
import type { GameMap } from '../../react-three-capacitor/src/game/GameMap.js'
import {
  computeRoomPositions,
  computeWalkableArea,
  getRoomAtPosition,
  validateWorldSpec,
} from '../../react-three-capacitor/src/game/WorldSpec.js'
import { buildCameraConstraintShapes } from '../../react-three-capacitor/src/game/CameraConstraint.js'

const CAPSULE_RADIUS = 0.0282

const GRID_X = 0.4028
const GRID_Z = 0.25
const VOTE_R = 0.1450

const WORLD_SPEC: WorldSpec = {
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

const ROOM_POSITIONS = computeRoomPositions(WORLD_SPEC)
validateWorldSpec(WORLD_SPEC, ROOM_POSITIONS)
const CAMERA_SHAPES = buildCameraConstraintShapes(WORLD_SPEC, ROOM_POSITIONS)
const WALKABLE = computeWalkableArea(WORLD_SPEC, ROOM_POSITIONS, CAPSULE_RADIUS)

const GAME_SPEC: GameSpec = {
  instructionSpecs: [
    { id: 'join_instruction',    text: 'Find your partner',   label: 'COMMAND' },
    { id: 'warning_instruction', text: '10 seconds to vote!', label: 'COMMAND' },
  ],
  voteRegions: [
    { id: 's2_v1', label: 'A', color: '#e74c3c', x: -GRID_X, z: -GRID_Z, radius: VOTE_R },
    { id: 's2_v2', label: 'B', color: '#3498db', x: +GRID_X, z: -GRID_Z, radius: VOTE_R },
    { id: 's2_v3', label: 'C', color: '#2ecc71', x: -GRID_X, z: +GRID_Z, radius: VOTE_R },
    { id: 's2_v4', label: 'D', color: '#f1c40f', x: +GRID_X, z: +GRID_Z, radius: VOTE_R },
  ],
  geometry: [],
}

export const SCENARIO2_MAP: GameMap = {
  id: 'scenario2',
  worldSpec: WORLD_SPEC,
  roomPositions: ROOM_POSITIONS,
  cameraShapes: CAMERA_SHAPES,
  walkable: WALKABLE,
  gameSpec: GAME_SPEC,
  npcs: [],
  getRoomAtPosition: (x, z) => getRoomAtPosition(WORLD_SPEC, ROOM_POSITIONS, x, z),
}
