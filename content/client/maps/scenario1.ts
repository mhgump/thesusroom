import type { WorldSpec, WalkableArea } from '../../../react-three-capacitor/src/game/WorldSpec'
import type { GameSpec } from '../../../react-three-capacitor/src/game/GameSpec'
import type { ClientMap } from './registry'
import { computeRoomPositions, computeWalkableArea, getRoomAtPosition, validateWorldSpec } from '../../../react-three-capacitor/src/game/WorldSpec'
import { buildCameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint'
import { VIEWPORT_W, ROOM_DEPTH } from '../../../react-three-capacitor/src/game/constants'

const CAPSULE_RADIUS = 0.35

const ROOM_W = VIEWPORT_W * 1.5  // 30

export const S1_WORLD_SPEC: WorldSpec = {
  rooms: [
    {
      id: 'main', name: 'Scenario 1',
      floorWidth: ROOM_W,
      floorDepth: ROOM_DEPTH,
      barrierHeight: 0.3, barrierThickness: 0.3,
      cameraRect: {
        xMin: -(ROOM_W / 2 - VIEWPORT_W / 2),
        xMax:   ROOM_W / 2 - VIEWPORT_W / 2,
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
const VOTE_SPACING = ROOM_W / 4                          // 7.5
const VOTE_X = [-1.5, -0.5, 0.5, 1.5].map(f => f * VOTE_SPACING)
const VOTE_Z = -(ROOM_DEPTH / 2 - 2.5)
const VOTE_R = 1.8

const bt = 0.3  // wall thickness
const bh = 0.3  // wall height

const SIDE_X = VOTE_R + bt / 2      // 1.95
const SIDE_Z = VOTE_Z - 0.2         // center z of side walls
const SIDE_D = 4.0                  // side wall Z extent
const FRONT_Z = VOTE_Z + VOTE_R + bt / 2
const FRONT_W = (VOTE_R + bt) * 2  // 4.2

const S1_LOCKED_WALKABLE: WalkableArea = {
  rects: [
    // cage interiors
    { cx: VOTE_X[0], cz: VOTE_Z - R, hw: VOTE_R - R, hd: 1.8 },
    { cx: VOTE_X[1], cz: VOTE_Z - R, hw: VOTE_R - R, hd: 1.8 },
    { cx: VOTE_X[2], cz: VOTE_Z - R, hw: VOTE_R - R, hd: 1.8 },
    { cx: VOTE_X[3], cz: VOTE_Z - R, hw: VOTE_R - R, hd: 1.8 },
    // south main area
    { cx: 0, cz: 2.3, hw: ROOM_W / 2 - R, hd: (ROOM_DEPTH - 5.3) / 2 },
    // corridors (full z, limited x)
    { cx: -14.175, cz: 0, hw: 0.475, hd: ROOM_DEPTH / 2 - R },
    { cx:  -7.5,   cz: 0, hw: 1.3,   hd: ROOM_DEPTH / 2 - R },
    { cx:   0,     cz: 0, hw: 1.3,   hd: ROOM_DEPTH / 2 - R },
    { cx:   7.5,   cz: 0, hw: 1.3,   hd: ROOM_DEPTH / 2 - R },
    { cx:  14.175, cz: 0, hw: 0.475, hd: ROOM_DEPTH / 2 - R },
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
  initialVisibility: {
    's1_w1l': false, 's1_w1r': false, 's1_w1f': false,
    's1_w2l': false, 's1_w2r': false, 's1_w2f': false,
    's1_w3l': false, 's1_w3r': false, 's1_w3f': false,
    's1_w4l': false, 's1_w4r': false, 's1_w4f': false,
  },
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
