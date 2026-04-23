import type { MapSpec } from '../../../react-three-capacitor/server/src/ScenarioRegistry.js'
import type { WalkableArea } from '../../../react-three-capacitor/server/src/World.js'

const R = 0.0282

const GRID_X = 0.4028
const GRID_Z = 0.25
const VOTE_R = 0.1450

const WALKABLE: WalkableArea = {
  rects: [{ cx: 0, cz: 0, hw: 0.7774, hd: 0.4718 }],
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
