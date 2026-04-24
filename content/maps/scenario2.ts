import type { WorldSpec } from '../../react-three-capacitor/src/game/WorldSpec.js'
import type { GameSpec } from '../../react-three-capacitor/src/game/GameSpec.js'
import type { GameMap } from '../../react-three-capacitor/src/game/GameMap.js'
import {
  computeRoomPositions,
  computeWalkableArea,
  validateWorldSpec,
} from '../../react-three-capacitor/src/game/WorldSpec.js'
import { buildMapInstanceArtifacts } from '../../react-three-capacitor/src/game/MapInstance.js'
import { buildCameraConstraintShapes } from '../../react-three-capacitor/src/game/CameraConstraint.js'

const MAP_INSTANCE_ID = 'scenario2'

const CAPSULE_RADIUS = 0.0282
const bt = 0.025

const GRID_X = 0.4028
const GRID_Z = 0.25
const VOTE_R = 0.1450

const HW        = 1.6112 / 2      // 0.8056
const HD        = 1.0 / 2         // 0.5
const WALL_CZ   = HD - bt / 2     // 0.4875
const WALL_CX   = HW - bt / 2     // 0.7931
const EW_DEPTH  = 2 * (HD - bt)   // 0.950

const WORLD_SPEC: WorldSpec = {
  rooms: [
    {
      id: 'main', name: 'Scenario 2',
      floorWidth: 1.6112,
      floorDepth: 1.0,
      barrierHeight: bt, barrierThickness: bt,
      cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
      barrierSegments: [
        { cx:  0,       cz: -WALL_CZ, width: 1.6112, depth: bt       }, // north
        { cx:  0,       cz:  WALL_CZ, width: 1.6112, depth: bt       }, // south
        { cx:  WALL_CX, cz:  0,       width: bt,      depth: EW_DEPTH }, // east
        { cx: -WALL_CX, cz:  0,       width: bt,      depth: EW_DEPTH }, // west
      ],
    },
  ],
  connections: [],
  visibility: { main: [] },
}

const LOCAL_POSITIONS = computeRoomPositions(WORLD_SPEC)
validateWorldSpec(WORLD_SPEC, LOCAL_POSITIONS)
const ARTIFACTS = buildMapInstanceArtifacts(WORLD_SPEC, MAP_INSTANCE_ID)
const ROOM_POSITIONS = ARTIFACTS.roomPositions
const CAMERA_SHAPES = buildCameraConstraintShapes(WORLD_SPEC, LOCAL_POSITIONS)
const WALKABLE = computeWalkableArea(WORLD_SPEC, LOCAL_POSITIONS, CAPSULE_RADIUS)

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
  mapInstanceId: MAP_INSTANCE_ID,
  worldSpec: WORLD_SPEC,
  roomPositions: ROOM_POSITIONS,
  cameraShapes: CAMERA_SHAPES,
  walkable: WALKABLE,
  gameSpec: GAME_SPEC,
  npcs: [],
  getRoomAtPosition: ARTIFACTS.getRoomAtPosition,
  getAdjacentRoomIds: ARTIFACTS.getAdjacentRoomIds,
  isRoomOverlapping: ARTIFACTS.isRoomOverlapping,
}
