import type { WorldSpec } from '../../../react-three-capacitor/src/game/WorldSpec.js'
import type { GameSpec } from '../../../react-three-capacitor/src/game/GameSpec.js'
import type { GameMap } from '../../../react-three-capacitor/src/game/GameMap.js'
import {
  computeRoomPositions,
  validateWorldSpec,
} from '../../../react-three-capacitor/src/game/WorldSpec.js'
import { buildMapInstanceArtifacts } from '../../../react-three-capacitor/src/game/MapInstance.js'
import { buildCameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint.js'

const MAP_INSTANCE_ID = 'scenario2'

const bt = 0.025
const bh = 0.025
const BY = bh / 2
const ROOM_W = 1.6112
const ROOM_D = 1.0
const ROOM_H = 0.5

const GRID_X = 0.4028
const GRID_Z = 0.25
const VOTE_R = 0.1450

const HW        = ROOM_W / 2
const HD        = ROOM_D / 2
const WALL_CZ   = HD - bt / 2
const WALL_CX   = HW - bt / 2
const EW_DEPTH  = 2 * (HD - bt)

const WORLD_SPEC: WorldSpec = {
  rooms: [
    {
      id: 'main', name: 'Scenario 2',
      floorWidth: ROOM_W,
      floorDepth: ROOM_D,
      height: ROOM_H,
      cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
      geometry: [
        { id: 's2_wn', cx: 0,        cy: BY, cz: -WALL_CZ, width: ROOM_W, height: bh, depth: bt },
        { id: 's2_ws', cx: 0,        cy: BY, cz:  WALL_CZ, width: ROOM_W, height: bh, depth: bt },
        { id: 's2_we', cx:  WALL_CX, cy: BY, cz: 0,        width: bt,     height: bh, depth: EW_DEPTH },
        { id: 's2_ww', cx: -WALL_CX, cy: BY, cz: 0,        width: bt,     height: bh, depth: EW_DEPTH },
      ],
    },
  ],
  connections: [],
}

const LOCAL_POSITIONS = computeRoomPositions(WORLD_SPEC)
validateWorldSpec(WORLD_SPEC, LOCAL_POSITIONS)
const ARTIFACTS = buildMapInstanceArtifacts(WORLD_SPEC, MAP_INSTANCE_ID)
const CAMERA_SHAPES = buildCameraConstraintShapes(WORLD_SPEC, LOCAL_POSITIONS)

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
}

export const MAP: GameMap = {
  id: 'scenario2',
  mapInstanceId: MAP_INSTANCE_ID,
  worldSpec: WORLD_SPEC,
  roomPositions: ARTIFACTS.roomPositions,
  cameraShapes: CAMERA_SHAPES,
  gameSpec: GAME_SPEC,
  npcs: [],
  getRoomAtPosition: ARTIFACTS.getRoomAtPosition,
  getAdjacentRoomIds: ARTIFACTS.getAdjacentRoomIds,
  isRoomOverlapping: ARTIFACTS.isRoomOverlapping,
}
