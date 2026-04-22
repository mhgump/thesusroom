import type { WorldSpec } from '../../../react-three-capacitor/src/game/WorldSpec'
import type { GameSpec } from '../../../react-three-capacitor/src/game/GameSpec'
import type { ClientMap } from './registry'
import {
  computeRoomPositions,
  computeWalkableArea,
  getRoomAtPosition,
  validateWorldSpec,
} from '../../../react-three-capacitor/src/game/WorldSpec'
import { buildCameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint'

const CAPSULE_RADIUS = 0.35
const ROOM_SIZE = 12

const BTN_Z = 0
const BTN_LEFT_X = -2.5
const BTN_RIGHT_X = 2.5
const BTN_TRIGGER_R = 0.8

export const S3_WORLD_SPEC: WorldSpec = {
  rooms: [
    {
      id: 'main', name: 'Scenario 3',
      floorWidth: ROOM_SIZE,
      floorDepth: ROOM_SIZE,
      barrierHeight: 0.3, barrierThickness: 0.3,
      cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
    },
  ],
  connections: [],
  visibility: { main: [] },
}

export const S3_ROOM_POSITIONS = computeRoomPositions(S3_WORLD_SPEC)
validateWorldSpec(S3_WORLD_SPEC, S3_ROOM_POSITIONS)
export const S3_WALKABLE = computeWalkableArea(S3_WORLD_SPEC, S3_ROOM_POSITIONS, CAPSULE_RADIUS)
export const S3_CAMERA_SHAPES = buildCameraConstraintShapes(S3_WORLD_SPEC, S3_ROOM_POSITIONS)

export const S3_GAME_SPEC: GameSpec = {
  instructionSpecs: [],
  voteRegions: [],
  geometry: [],
  buttons: [
    {
      id: 'btn_left',
      x: BTN_LEFT_X,
      z: BTN_Z,
      triggerRadius: BTN_TRIGGER_R,
      ringOuterRadius: 1.4,
      ringInnerRadius: 0.9,
      platformRadius: 0.6,
      raisedHeight: 0.18,
      color: '#c0392b',
      ringColor: '#e74c3c',
      requiredPlayers: 1,
      holdAfterRelease: false,
      cooldownMs: 0,
      enableClientPress: true,
    },
    {
      id: 'btn_right',
      x: BTN_RIGHT_X,
      z: BTN_Z,
      triggerRadius: BTN_TRIGGER_R,
      ringOuterRadius: 1.4,
      ringInnerRadius: 0.9,
      platformRadius: 0.6,
      raisedHeight: 0.18,
      color: '#1a5276',
      ringColor: '#2980b9',
      requiredPlayers: 2,
      holdAfterRelease: false,
      cooldownMs: 0,
      enableClientPress: false,
    },
  ],
}

export const SCENARIO3_CLIENT_MAP: ClientMap = {
  worldSpec: S3_WORLD_SPEC,
  roomPositions: S3_ROOM_POSITIONS,
  cameraShapes: S3_CAMERA_SHAPES,
  walkable: S3_WALKABLE,
  gameSpec: S3_GAME_SPEC,
  getRoomAtPosition: (x, z) =>
    getRoomAtPosition(S3_WORLD_SPEC, S3_ROOM_POSITIONS, x, z) ?? S3_WORLD_SPEC.rooms[0].id,
}
