import type { WorldSpec } from '../../../react-three-capacitor/src/game/WorldSpec.js'
import type { GameSpec } from '../../../react-three-capacitor/src/game/GameSpec.js'
import type { GameMap } from '../../../react-three-capacitor/src/game/GameMap.js'
import {
  computeRoomPositions,
  validateWorldSpec,
} from '../../../react-three-capacitor/src/game/WorldSpec.js'
import { buildMapInstanceArtifacts } from '../../../react-three-capacitor/src/game/MapInstance.js'
import { buildCameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint.js'

const MAP_INSTANCE_ID = 'scenario5'

const bt = 0.025
const bh = 0.025
const BY = bh / 2
const HALL_W = 0.25
const HALL_D = 1.5
const ROOM_H = 0.5

const HD_Z     = HALL_D / 2
const HD_X     = HALL_W / 2
const WALL_CZ  = HD_Z - bt / 2
const WALL_CX  = HD_X - bt / 2
const EW_DEPTH = 2 * (HD_Z - bt)

const WORLD_SPEC: WorldSpec = {
  rooms: [
    {
      id: 'hall', name: 'Scenario 5',
      floorWidth: HALL_W,
      floorDepth: HALL_D,
      height: ROOM_H,
      cameraRect: { xMin: -HD_X, xMax: HD_X, zMin: -HD_Z, zMax: HD_Z },
      geometry: [
        { id: 's5_wn', cx: 0,        cy: BY, cz: -WALL_CZ, width: HALL_W, height: bh, depth: bt },
        { id: 's5_ws', cx: 0,        cy: BY, cz:  WALL_CZ, width: HALL_W, height: bh, depth: bt },
        { id: 's5_we', cx:  WALL_CX, cy: BY, cz: 0,        width: bt,     height: bh, depth: EW_DEPTH },
        { id: 's5_ww', cx: -WALL_CX, cy: BY, cz: 0,        width: bt,     height: bh, depth: EW_DEPTH },
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
  instructionSpecs: [],
  voteRegions: [],
}

export const MAP: GameMap = {
  id: 'scenario5',
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
