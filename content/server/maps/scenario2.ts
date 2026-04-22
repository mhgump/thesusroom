import type { MapSpec } from '../../../react-three-capacitor/server/src/ScenarioRegistry.js'
import type { WalkableArea } from '../../../react-three-capacitor/server/src/World.js'

const R = 0.35  // CAPSULE_RADIUS — must match World.ts

const VIEWPORT_W = 20
const CAMERA_ANGLE = 25 * (Math.PI / 180)
const VIEWPORT_D = (VIEWPORT_W / (16 / 9)) / Math.cos(CAMERA_ANGLE)

const GRID_X = VIEWPORT_W / 4    // 5
const GRID_Z = VIEWPORT_D / 4    // ~3.1
const VOTE_R = 1.8

const WALKABLE: WalkableArea = {
  rects: [{ cx: 0, cz: 0, hw: VIEWPORT_W / 2 - R, hd: VIEWPORT_D / 2 - R }],
}

export const SCENARIO2_MAP: MapSpec = {
  id: 'scenario2',
  walkable: WALKABLE,
  npcs: [],
  voteRegions: [
    { id: 's2_v1', label: 'A', color: '#e74c3c', x: -GRID_X, z: -GRID_Z, radius: VOTE_R },
    { id: 's2_v2', label: 'B', color: '#3498db', x: +GRID_X, z: -GRID_Z, radius: VOTE_R },
    { id: 's2_v3', label: 'C', color: '#2ecc71', x: -GRID_X, z: +GRID_Z, radius: VOTE_R },
    { id: 's2_v4', label: 'D', color: '#f1c40f', x: +GRID_X, z: +GRID_Z, radius: VOTE_R },
  ],
}
