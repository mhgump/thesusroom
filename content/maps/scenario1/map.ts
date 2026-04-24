import type { GameMap } from '../../../react-three-capacitor/src/game/GameMap.js'
import type { RoomSpec } from '../../../react-three-capacitor/src/game/RoomSpec.js'
import type {
  InstructionEventSpec,
  VoteRegionSpec,
} from '../../../react-three-capacitor/src/game/GameSpec.js'
import {
  computeRoomPositions,
  validateWorldSpec,
} from '../../../react-three-capacitor/src/game/WorldSpec.js'
import { buildMapInstanceArtifacts } from '../../../react-three-capacitor/src/game/MapInstance.js'
import { buildCameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint.js'

const MAP_INSTANCE_ID = 'scenario1'

const ROOM_W = 2.4168
const ROOM_D = 0.75
const ROOM_H = 0.5

const VOTE_X = [-0.9063, -0.3021, 0.3021, 0.9063]
const VOTE_Z = -0.1736
const VOTE_R = 0.1450

const bt = 0.025
const bh = 0.025
const BY = bh / 2

const HW        = ROOM_W / 2
const HD        = ROOM_D / 2
const WALL_CZ   = HD - bt / 2
const WALL_CX   = HW - bt / 2
const EW_DEPTH  = 2 * (HD - bt)

const SIDE_X = 0.1571
const SIDE_Z = -0.1897
const SIDE_D = 0.3222
const FRONT_Z = -0.0165
const FRONT_W = 0.3384

const cellWalls = VOTE_X.flatMap((vx, i) => {
  const n = i + 1
  return [
    { id: `s1_w${n}l`, cx: vx - SIDE_X, cy: BY, cz: SIDE_Z,  width: bt,      height: bh, depth: SIDE_D, color: '#888' },
    { id: `s1_w${n}r`, cx: vx + SIDE_X, cy: BY, cz: SIDE_Z,  width: bt,      height: bh, depth: SIDE_D, color: '#888' },
    { id: `s1_w${n}f`, cx: vx,          cy: BY, cz: FRONT_Z, width: FRONT_W, height: bh, depth: bt,     color: '#888' },
  ]
})

const ROOMS: RoomSpec[] = [
  {
    id: 'main', name: 'Scenario 1',
    floorWidth: ROOM_W,
    floorDepth: ROOM_D,
    height: ROOM_H,
    cameraRect: { xMin: -0.4028, xMax: 0.4028, zMin: 0, zMax: 0 },
    geometry: [
      { id: 's1_wn', cx: 0,        cy: BY, cz: -WALL_CZ, width: ROOM_W, height: bh, depth: bt },
      { id: 's1_ws', cx: 0,        cy: BY, cz:  WALL_CZ, width: ROOM_W, height: bh, depth: bt },
      { id: 's1_we', cx:  WALL_CX, cy: BY, cz: 0,        width: bt,     height: bh, depth: EW_DEPTH },
      { id: 's1_ww', cx: -WALL_CX, cy: BY, cz: 0,        width: bt,     height: bh, depth: EW_DEPTH },
      ...cellWalls,
    ],
  },
]

const TOPOLOGY = { rooms: ROOMS, connections: [] }
const LOCAL_POSITIONS = computeRoomPositions(TOPOLOGY)
validateWorldSpec(TOPOLOGY, LOCAL_POSITIONS)
const ARTIFACTS = buildMapInstanceArtifacts(TOPOLOGY, MAP_INSTANCE_ID)
const CAMERA_SHAPES = buildCameraConstraintShapes(TOPOLOGY, LOCAL_POSITIONS)

const INSTRUCTION_SPECS: InstructionEventSpec[] = [
  { id: 'find_instruction', text: 'Find your circle', label: 'COMMAND' },
  { id: 'vote_instruction', text: 'Vote called!',     label: 'COMMAND' },
]

const VOTE_REGIONS: VoteRegionSpec[] = [
  { id: 's1_v1', label: '1', color: '#e74c3c', x: VOTE_X[0], z: VOTE_Z, radius: VOTE_R },
  { id: 's1_v2', label: '2', color: '#3498db', x: VOTE_X[1], z: VOTE_Z, radius: VOTE_R },
  { id: 's1_v3', label: '3', color: '#2ecc71', x: VOTE_X[2], z: VOTE_Z, radius: VOTE_R },
  { id: 's1_v4', label: '4', color: '#f1c40f', x: VOTE_X[3], z: VOTE_Z, radius: VOTE_R },
]

export const MAP: GameMap = {
  id: 'scenario1',
  mapInstanceId: MAP_INSTANCE_ID,
  rooms: ROOMS,
  connections: [],
  roomPositions: ARTIFACTS.roomPositions,
  cameraShapes: CAMERA_SHAPES,
  instructionSpecs: INSTRUCTION_SPECS,
  voteRegions: VOTE_REGIONS,
  npcs: [],
  getRoomAtPosition: ARTIFACTS.getRoomAtPosition,
  getAdjacentRoomIds: ARTIFACTS.getAdjacentRoomIds,
  isRoomOverlapping: ARTIFACTS.isRoomOverlapping,
}
