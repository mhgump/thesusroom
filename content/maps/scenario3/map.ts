import type { WorldSpec } from '../../../react-three-capacitor/src/game/WorldSpec.js'
import type { GameSpec } from '../../../react-three-capacitor/src/game/GameSpec.js'
import type { GameMap } from '../../../react-three-capacitor/src/game/GameMap.js'
import {
  computeRoomPositions,
  validateWorldSpec,
} from '../../../react-three-capacitor/src/game/WorldSpec.js'
import { buildMapInstanceArtifacts } from '../../../react-three-capacitor/src/game/MapInstance.js'
import { buildCameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint.js'

const MAP_INSTANCE_ID = 'scenario3'

const ROOM_SIZE = 0.9672
const ROOM_H = 0.5
const bt = 0.025
const bh = 0.025
const BY = bh / 2

const HD        = ROOM_SIZE / 2
const WALL_C    = HD - bt / 2
const EW_DEPTH  = 2 * (HD - bt)

const BTN_Z = 0
const BTN_LEFT_X = -0.2014
const BTN_RIGHT_X = 0.2014
const BTN_TRIGGER_R = 0.0645

const WORLD_SPEC: WorldSpec = {
  rooms: [
    {
      id: 'main', name: 'Scenario 3',
      floorWidth: ROOM_SIZE,
      floorDepth: ROOM_SIZE,
      height: ROOM_H,
      cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
      geometry: [
        { id: 's3_wn', cx: 0,       cy: BY, cz: -WALL_C, width: ROOM_SIZE, height: bh, depth: bt },
        { id: 's3_ws', cx: 0,       cy: BY, cz:  WALL_C, width: ROOM_SIZE, height: bh, depth: bt },
        { id: 's3_we', cx:  WALL_C, cy: BY, cz: 0,       width: bt,        height: bh, depth: EW_DEPTH },
        { id: 's3_ww', cx: -WALL_C, cy: BY, cz: 0,       width: bt,        height: bh, depth: EW_DEPTH },
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
  voteRegions: [
    { id: 's3_rzone', label: '', color: 'transparent', x: BTN_RIGHT_X, z: BTN_Z, radius: BTN_TRIGGER_R },
  ],
  buttons: [
    {
      id: 'btn_left',
      x: BTN_LEFT_X, z: BTN_Z,
      triggerRadius: BTN_TRIGGER_R,
      platformRadius: 0.0483,
      ringOuterRadius: 0.0531,
      ringInnerRadius: 0.0483,
      raisedHeight: 0.0145,
      color: '#c0392b', ringColor: '#e74c3c',
      requiredPlayers: 1, holdAfterRelease: false, cooldownMs: 0, enableClientPress: true,
    },
    {
      id: 'btn_right',
      x: BTN_RIGHT_X, z: BTN_Z,
      triggerRadius: BTN_TRIGGER_R,
      platformRadius: 0.0483,
      ringOuterRadius: 0.0531,
      ringInnerRadius: 0.0483,
      raisedHeight: 0.0145,
      color: '#1a5276', ringColor: '#2980b9',
      requiredPlayers: 2, holdAfterRelease: false, cooldownMs: 0, enableClientPress: false,
    },
  ],
}

export const MAP: GameMap = {
  id: 'scenario3',
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
