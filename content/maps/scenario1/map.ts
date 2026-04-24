import type { WorldSpec } from '../../../react-three-capacitor/src/game/WorldSpec.js'
import type { GameSpec } from '../../../react-three-capacitor/src/game/GameSpec.js'
import type { GameMap } from '../../../react-three-capacitor/src/game/GameMap.js'
import {
  computeRoomPositions,
  computeWalkableArea,
  validateWorldSpec,
} from '../../../react-three-capacitor/src/game/WorldSpec.js'
import { buildMapInstanceArtifacts } from '../../../react-three-capacitor/src/game/MapInstance.js'
import { buildCameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint.js'
import type { WalkableArea } from '../../../react-three-capacitor/src/game/WorldSpec.js'

const MAP_INSTANCE_ID = 'scenario1'

const CAPSULE_RADIUS = 0.0282

const ROOM_W = 2.4168
const ROOM_D = 0.75

const VOTE_X = [-0.9063, -0.3021, 0.3021, 0.9063]
const VOTE_Z = -0.1736
const VOTE_R = 0.1450

const bt = 0.025
const bh = 0.025

const HW        = ROOM_W / 2      // 1.2084
const HD        = ROOM_D / 2      // 0.375
const WALL_CZ   = HD - bt / 2     // 0.3625
const WALL_CX   = HW - bt / 2     // 1.1959
const EW_DEPTH  = 2 * (HD - bt)   // 0.700

const SIDE_X = 0.1571
const SIDE_Z = -0.1897
const SIDE_D = 0.3222
const FRONT_Z = -0.0165
const FRONT_W = 0.3384

const WORLD_SPEC: WorldSpec = {
  rooms: [
    {
      id: 'main', name: 'Scenario 1',
      floorWidth: ROOM_W,
      floorDepth: ROOM_D,
      barrierHeight: bt, barrierThickness: bt,
      cameraRect: { xMin: -0.4028, xMax: 0.4028, zMin: 0, zMax: 0 },
      barrierSegments: [
        { cx:  0,       cz: -WALL_CZ, width: ROOM_W, depth: bt       }, // north
        { cx:  0,       cz:  WALL_CZ, width: ROOM_W, depth: bt       }, // south
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
const WALKABLE_DEFAULT = computeWalkableArea(WORLD_SPEC, LOCAL_POSITIONS, CAPSULE_RADIUS)

const LOCKED_WALKABLE: WalkableArea = {
  rects: [
    { cx: VOTE_X[0], cz: -0.2018, hw: 0.1168, hd: 0.1450 },
    { cx: VOTE_X[1], cz: -0.2018, hw: 0.1168, hd: 0.1450 },
    { cx: VOTE_X[2], cz: -0.2018, hw: 0.1168, hd: 0.1450 },
    { cx: VOTE_X[3], cz: -0.2018, hw: 0.1168, hd: 0.1450 },
    { cx: 0, cz: 0.1853, hw: 1.1802, hd: 0.1615 },
    { cx: -1.1421, cz: 0, hw: 0.0383, hd: 0.3468 },
    { cx:  -0.6042, cz: 0, hw: 0.1047, hd: 0.3468 },
    { cx:   0,      cz: 0, hw: 0.1047, hd: 0.3468 },
    { cx:   0.6042, cz: 0, hw: 0.1047, hd: 0.3468 },
    { cx:   1.1421, cz: 0, hw: 0.0383, hd: 0.3468 },
  ],
}

const GAME_SPEC: GameSpec = {
  instructionSpecs: [
    { id: 'find_instruction', text: 'Find your circle', label: 'COMMAND' },
    { id: 'vote_instruction', text: 'Vote called!',     label: 'COMMAND' },
  ],
  voteRegions: [
    { id: 's1_v1', label: '1', color: '#e74c3c', x: VOTE_X[0], z: VOTE_Z, radius: VOTE_R },
    { id: 's1_v2', label: '2', color: '#3498db', x: VOTE_X[1], z: VOTE_Z, radius: VOTE_R },
    { id: 's1_v3', label: '3', color: '#2ecc71', x: VOTE_X[2], z: VOTE_Z, radius: VOTE_R },
    { id: 's1_v4', label: '4', color: '#f1c40f', x: VOTE_X[3], z: VOTE_Z, radius: VOTE_R },
  ],
  geometry: [
    { id: 's1_w1l', x: VOTE_X[0] - SIDE_X, z: SIDE_Z, width: bt, depth: SIDE_D, height: bh, color: '#888' },
    { id: 's1_w1r', x: VOTE_X[0] + SIDE_X, z: SIDE_Z, width: bt, depth: SIDE_D, height: bh, color: '#888' },
    { id: 's1_w1f', x: VOTE_X[0],           z: FRONT_Z, width: FRONT_W, depth: bt, height: bh, color: '#888' },
    { id: 's1_w2l', x: VOTE_X[1] - SIDE_X, z: SIDE_Z, width: bt, depth: SIDE_D, height: bh, color: '#888' },
    { id: 's1_w2r', x: VOTE_X[1] + SIDE_X, z: SIDE_Z, width: bt, depth: SIDE_D, height: bh, color: '#888' },
    { id: 's1_w2f', x: VOTE_X[1],           z: FRONT_Z, width: FRONT_W, depth: bt, height: bh, color: '#888' },
    { id: 's1_w3l', x: VOTE_X[2] - SIDE_X, z: SIDE_Z, width: bt, depth: SIDE_D, height: bh, color: '#888' },
    { id: 's1_w3r', x: VOTE_X[2] + SIDE_X, z: SIDE_Z, width: bt, depth: SIDE_D, height: bh, color: '#888' },
    { id: 's1_w3f', x: VOTE_X[2],           z: FRONT_Z, width: FRONT_W, depth: bt, height: bh, color: '#888' },
    { id: 's1_w4l', x: VOTE_X[3] - SIDE_X, z: SIDE_Z, width: bt, depth: SIDE_D, height: bh, color: '#888' },
    { id: 's1_w4r', x: VOTE_X[3] + SIDE_X, z: SIDE_Z, width: bt, depth: SIDE_D, height: bh, color: '#888' },
    { id: 's1_w4f', x: VOTE_X[3],           z: FRONT_Z, width: FRONT_W, depth: bt, height: bh, color: '#888' },
  ],
}

export const MAP: GameMap = {
  id: 'scenario1',
  mapInstanceId: MAP_INSTANCE_ID,
  worldSpec: WORLD_SPEC,
  roomPositions: ROOM_POSITIONS,
  cameraShapes: CAMERA_SHAPES,
  walkable: WALKABLE_DEFAULT,
  gameSpec: GAME_SPEC,
  npcs: [],
  getRoomAtPosition: ARTIFACTS.getRoomAtPosition,
  getAdjacentRoomIds: ARTIFACTS.getAdjacentRoomIds,
  isRoomOverlapping: ARTIFACTS.isRoomOverlapping,
  walkableVariants: [
    { triggerIds: ['s1_w1f', 's1_w2f', 's1_w3f', 's1_w4f'], walkable: LOCKED_WALKABLE },
  ],
}
