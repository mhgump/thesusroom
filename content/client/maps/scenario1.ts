import type { WorldSpec, WalkableArea } from '../../../react-three-capacitor/src/game/WorldSpec'
import type { GameSpec } from '../../../react-three-capacitor/src/game/GameSpec'
import type { ClientMap } from './registry'
import { computeRoomPositions, computeWalkableArea, getRoomAtPosition, validateWorldSpec } from '../../../react-three-capacitor/src/game/WorldSpec'
import { buildCameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint'

const CAPSULE_RADIUS = 0.0282

const ROOM_W = 2.4168
const ROOM_D = 0.75

export const S1_WORLD_SPEC: WorldSpec = {
  rooms: [
    {
      id: 'main', name: 'Scenario 1',
      floorWidth: ROOM_W,
      floorDepth: ROOM_D,
      barrierHeight: 0.0242, barrierThickness: 0.0242,
      cameraRect: {
        xMin: -0.4028,
        xMax:  0.4028,
        zMin: 0, zMax: 0,
      },
    },
  ],
  connections: [],
  visibility: { main: [] },
}

export const S1_ROOM_POSITIONS = computeRoomPositions(S1_WORLD_SPEC)
validateWorldSpec(S1_WORLD_SPEC, S1_ROOM_POSITIONS)
export const S1_WALKABLE = computeWalkableArea(S1_WORLD_SPEC, S1_ROOM_POSITIONS, CAPSULE_RADIUS)
export const S1_CAMERA_SHAPES = buildCameraConstraintShapes(S1_WORLD_SPEC, S1_ROOM_POSITIONS)

function getS1RoomAtPosition(x: number, z: number): string {
  return getRoomAtPosition(S1_WORLD_SPEC, S1_ROOM_POSITIONS, x, z) ?? S1_WORLD_SPEC.rooms[0].id
}

// Vote positions matching content/server/maps/scenario1.ts
const R = CAPSULE_RADIUS
const VOTE_SPACING = 0.6042
const VOTE_X = [-0.9063, -0.3021, 0.3021, 0.9063]
const VOTE_Z = -0.1736
const VOTE_R = 0.1450

const bt = 0.0242  // wall thickness
const bh = 0.0242  // wall height

const SIDE_X = 0.1571
const SIDE_Z = -0.1897
const SIDE_D = 0.3222
const FRONT_Z = -0.0165
const FRONT_W = 0.3384

const S1_LOCKED_WALKABLE: WalkableArea = {
  rects: [
    // cage interiors
    { cx: VOTE_X[0], cz: -0.2018, hw: 0.1168, hd: 0.1450 },
    { cx: VOTE_X[1], cz: -0.2018, hw: 0.1168, hd: 0.1450 },
    { cx: VOTE_X[2], cz: -0.2018, hw: 0.1168, hd: 0.1450 },
    { cx: VOTE_X[3], cz: -0.2018, hw: 0.1168, hd: 0.1450 },
    // south main area
    { cx: 0, cz: 0.1853, hw: 1.1802, hd: 0.1615 },
    // corridors (full z, limited x)
    { cx: -1.1421, cz: 0, hw: 0.0383, hd: 0.3468 },
    { cx:  -0.6042, cz: 0, hw: 0.1047, hd: 0.3468 },
    { cx:   0,      cz: 0, hw: 0.1047, hd: 0.3468 },
    { cx:   0.6042, cz: 0, hw: 0.1047, hd: 0.3468 },
    { cx:   1.1421, cz: 0, hw: 0.0383, hd: 0.3468 },
  ],
}

export const S1_GAME_SPEC: GameSpec = {
  instructionSpecs: [],
  voteRegions: [
    { id: 's1_v1', label: '1', color: '#e74c3c', x: VOTE_X[0], z: VOTE_Z, radius: VOTE_R },
    { id: 's1_v2', label: '2', color: '#3498db', x: VOTE_X[1], z: VOTE_Z, radius: VOTE_R },
    { id: 's1_v3', label: '3', color: '#2ecc71', x: VOTE_X[2], z: VOTE_Z, radius: VOTE_R },
    { id: 's1_v4', label: '4', color: '#f1c40f', x: VOTE_X[3], z: VOTE_Z, radius: VOTE_R },
  ],
  geometry: [
    // cage 1 walls
    { id: 's1_w1l', x: VOTE_X[0] - SIDE_X, z: SIDE_Z, width: bt, depth: SIDE_D, height: bh, color: '#888' },
    { id: 's1_w1r', x: VOTE_X[0] + SIDE_X, z: SIDE_Z, width: bt, depth: SIDE_D, height: bh, color: '#888' },
    { id: 's1_w1f', x: VOTE_X[0],           z: FRONT_Z, width: FRONT_W, depth: bt, height: bh, color: '#888' },
    // cage 2 walls
    { id: 's1_w2l', x: VOTE_X[1] - SIDE_X, z: SIDE_Z, width: bt, depth: SIDE_D, height: bh, color: '#888' },
    { id: 's1_w2r', x: VOTE_X[1] + SIDE_X, z: SIDE_Z, width: bt, depth: SIDE_D, height: bh, color: '#888' },
    { id: 's1_w2f', x: VOTE_X[1],           z: FRONT_Z, width: FRONT_W, depth: bt, height: bh, color: '#888' },
    // cage 3 walls
    { id: 's1_w3l', x: VOTE_X[2] - SIDE_X, z: SIDE_Z, width: bt, depth: SIDE_D, height: bh, color: '#888' },
    { id: 's1_w3r', x: VOTE_X[2] + SIDE_X, z: SIDE_Z, width: bt, depth: SIDE_D, height: bh, color: '#888' },
    { id: 's1_w3f', x: VOTE_X[2],           z: FRONT_Z, width: FRONT_W, depth: bt, height: bh, color: '#888' },
    // cage 4 walls
    { id: 's1_w4l', x: VOTE_X[3] - SIDE_X, z: SIDE_Z, width: bt, depth: SIDE_D, height: bh, color: '#888' },
    { id: 's1_w4r', x: VOTE_X[3] + SIDE_X, z: SIDE_Z, width: bt, depth: SIDE_D, height: bh, color: '#888' },
    { id: 's1_w4f', x: VOTE_X[3],           z: FRONT_Z, width: FRONT_W, depth: bt, height: bh, color: '#888' },
  ],
}

export const SCENARIO1_CLIENT_MAP: ClientMap = {
  worldSpec: S1_WORLD_SPEC,
  roomPositions: S1_ROOM_POSITIONS,
  cameraShapes: S1_CAMERA_SHAPES,
  walkable: S1_WALKABLE,
  gameSpec: S1_GAME_SPEC,
  getRoomAtPosition: getS1RoomAtPosition,
  walkableVariants: [
    { triggerIds: ['s1_w1f', 's1_w2f', 's1_w3f', 's1_w4f'], walkable: S1_LOCKED_WALKABLE },
  ],
}
