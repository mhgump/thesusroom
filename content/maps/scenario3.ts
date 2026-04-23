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
const ROOM_SIZE = 0.9672

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
  instructionSpecs: [],
  voteRegions: [
    { id: 's3_rzone', label: '', color: 'transparent', x: BTN_RIGHT_X, z: BTN_Z, radius: BTN_TRIGGER_R },
  ],
  geometry: [],
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

export const SCENARIO3_MAP: GameMap = {
  id: 'scenario3',
  worldSpec: WORLD_SPEC,
  roomPositions: ROOM_POSITIONS,
  cameraShapes: CAMERA_SHAPES,
  walkable: WALKABLE,
  gameSpec: GAME_SPEC,
  npcs: [],
  getRoomAtPosition: (x, z) => getRoomAtPosition(WORLD_SPEC, ROOM_POSITIONS, x, z),
}
