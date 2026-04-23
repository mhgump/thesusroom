import type { MapSpec } from '../../../react-three-capacitor/server/src/ScenarioRegistry.js'
import type { WalkableArea } from '../../../react-three-capacitor/server/src/World.js'

const R = 0.0282

const ROOM_W = 2.4168
const ROOM_D = 0.75

const VOTE_SPACING = 0.6042
const VOTE_X = [-0.9063, -0.3021, 0.3021, 0.9063]
const VOTE_Z = -0.1736
const VOTE_R = 0.1450

const bt = 0.0242
const bh = 0.0242

const SIDE_X = 0.1571
const SIDE_Z = -0.1897
const SIDE_D = 0.3222
const FRONT_Z = -0.0165
const FRONT_W = 0.3384

const WALKABLE_DEFAULT: WalkableArea = {
  rects: [{ cx: 0, cz: 0, hw: 1.1802, hd: 0.3468 }],
}

const LOCKED_WALKABLE: WalkableArea = {
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

export const SCENARIO1_MAP: MapSpec = {
  id: 'scenario1',
  walkable: WALKABLE_DEFAULT,
  walkableVariants: [
    { triggerIds: ['s1_w1f', 's1_w2f', 's1_w3f', 's1_w4f'], walkable: LOCKED_WALKABLE },
  ],
  npcs: [],
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
