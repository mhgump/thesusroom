import type { GameMap } from '../../../react-three-capacitor/src/game/GameMap.js'
import type { RoomSpec } from '../../../react-three-capacitor/src/game/RoomSpec.js'
import type {
  InstructionEventSpec,
  VoteRegionSpec,
} from '../../../react-three-capacitor/src/game/GameSpec.js'
import type { RoomConnection } from '../../../react-three-capacitor/src/game/WorldSpec.js'
import {
  computeRoomPositions,
  validateWorldSpec,
} from '../../../react-three-capacitor/src/game/WorldSpec.js'
import { buildMapInstanceArtifacts } from '../../../react-three-capacitor/src/game/MapInstance.js'
import { buildCameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint.js'

const MAP_INSTANCE_ID = 'scenario1'

// Main room is a small (~1.6 × 0.75) rectangle with four isolation cells
// lined up along the north half. Four 0.5 × 0.5 sub-rooms sit directly
// north of it — one per cell, centered on the cell's x — and each becomes
// reachable for its owner after the isolation walls pop up. Adjacent
// sub-rooms overlap by 0.1 but `buildMapInstanceArtifacts.overlapSet` and
// the client's `isRoomOverlapping` gate hide rooms from players that
// aren't currently inside them, so overlap is invisible at runtime. The
// four doors in main's north wall are placed at distinct x's so that the
// first-match room resolution picks the correct sub-room when a player
// walks through their door.
const ROOM_W = 1.6
const ROOM_D = 0.75
const ROOM_H = 0.5

const bt = 0.025
const bh = 0.025
const BY = bh / 2

const HW       = ROOM_W / 2
const HD       = ROOM_D / 2
const WALL_CZ  = HD - bt / 2
const WALL_CX  = HW - bt / 2
const EW_DEPTH = 2 * (HD - bt)

// South wall split: middle 0.25 segment is the hub dock.
const HUB_DOCK_W = 0.25
const S_SIDE_W   = (ROOM_W - HUB_DOCK_W) / 2
const S_SIDE_CX  = (ROOM_W + HUB_DOCK_W) / 4

// North wall: four 0.1 doors at circle x-positions (one per player) plus
// the 0.25 middle exit dock. Solid fillers tile the remaining span.
const DOOR_W      = 0.1
const EXIT_DOCK_W = 0.25
const D_HALF      = DOOR_W / 2
const EX_HALF     = EXIT_DOCK_W / 2

const VOTE_X = [-0.6, -0.2, 0.2, 0.6]
const VOTE_Z = -0.2
const VOTE_R = 0.08

// Cell geometry around each circle. Side walls flank the circle; a front
// wall plugs the south opening so the vote box is fully enclosed once the
// walls become visible.
const CELL_HALF_W = 0.1
const FRONT_Z     = -0.05
const FRONT_W     = 0.2
const NORTH_INNER_Z = -HD + bt               // -0.35
const FRONT_N_FACE  = FRONT_Z - bt / 2       // -0.0625
const SIDE_Z  = (NORTH_INNER_Z + FRONT_N_FACE) / 2
const SIDE_D  = FRONT_N_FACE - NORTH_INNER_Z

const cellWalls = VOTE_X.flatMap((vx, i) => {
  const n = i + 1
  return [
    { id: `s1_w${n}l`, cx: vx - CELL_HALF_W, cy: BY, cz: SIDE_Z,  width: bt,      height: bh, depth: SIDE_D, color: '#888' },
    { id: `s1_w${n}r`, cx: vx + CELL_HALF_W, cy: BY, cz: SIDE_Z,  width: bt,      height: bh, depth: SIDE_D, color: '#888' },
    { id: `s1_w${n}f`, cx: vx,               cy: BY, cz: FRONT_Z, width: FRONT_W, height: bh, depth: bt,     color: '#888' },
  ]
})

function seg(id: string, left: number, right: number, color?: string) {
  const cx = (left + right) / 2
  const width = right - left
  const base = { id, cx, cy: BY, cz: -WALL_CZ, width, height: bh, depth: bt }
  return color ? { ...base, color } : base
}

const northSegments = [
  seg('s1_wnl1', -HW,                    VOTE_X[0] - D_HALF),
  seg('s1_d1',   VOTE_X[0] - D_HALF,     VOTE_X[0] + D_HALF, '#555555'),
  seg('s1_wnl2', VOTE_X[0] + D_HALF,     VOTE_X[1] - D_HALF),
  seg('s1_d2',   VOTE_X[1] - D_HALF,     VOTE_X[1] + D_HALF, '#555555'),
  seg('s1_wnl3', VOTE_X[1] + D_HALF,     -EX_HALF),
  seg('s1_wne',  -EX_HALF,               EX_HALF),
  seg('s1_wnr3', EX_HALF,                VOTE_X[2] - D_HALF),
  seg('s1_d3',   VOTE_X[2] - D_HALF,     VOTE_X[2] + D_HALF, '#555555'),
  seg('s1_wnr2', VOTE_X[2] + D_HALF,     VOTE_X[3] - D_HALF),
  seg('s1_d4',   VOTE_X[3] - D_HALF,     VOTE_X[3] + D_HALF, '#555555'),
  seg('s1_wnr1', VOTE_X[3] + D_HALF,     HW),
]

// Sub-room: 0.5 × 0.5 box with N/E/W walls. The south boundary is owned by
// main's north wall, so no south wall geometry here — the toggleable door
// in main's north wall is what opens to admit the owning player.
const SUB_W = 0.5
const SUB_D = 0.5
const SUB_HD = SUB_D / 2
const SUB_HW = SUB_W / 2
const SUB_WALL_CZ = SUB_HD - bt / 2
const SUB_WALL_CX = SUB_HW - bt / 2
const SUB_EW_DEPTH = 2 * (SUB_HD - bt)

function subGeometry(prefix: string) {
  return [
    { id: `${prefix}_n`, cx: 0,             cy: BY, cz: -SUB_WALL_CZ, width: SUB_W,      height: bh, depth: bt },
    { id: `${prefix}_e`, cx:  SUB_WALL_CX,  cy: BY, cz: 0,            width: bt,         height: bh, depth: SUB_EW_DEPTH },
    { id: `${prefix}_w`, cx: -SUB_WALL_CX,  cy: BY, cz: 0,            width: bt,         height: bh, depth: SUB_EW_DEPTH },
  ]
}

const ROOMS: RoomSpec[] = [
  {
    id: 'main', name: 'Scenario 1',
    floorWidth: ROOM_W,
    floorDepth: ROOM_D,
    height: ROOM_H,
    cameraRect: { xMin: -0.4028, xMax: 0.4028, zMin: 0, zMax: 0 },
    geometry: [
      ...northSegments,
      { id: 's1_wsl', cx: -S_SIDE_CX,  cy: BY, cz:  WALL_CZ, width: S_SIDE_W,   height: bh, depth: bt },
      { id: 's1_ws',  cx: 0,           cy: BY, cz:  WALL_CZ, width: HUB_DOCK_W, height: bh, depth: bt },
      { id: 's1_wsr', cx:  S_SIDE_CX,  cy: BY, cz:  WALL_CZ, width: S_SIDE_W,   height: bh, depth: bt },
      { id: 's1_we',  cx:  WALL_CX,    cy: BY, cz: 0,        width: bt,         height: bh, depth: EW_DEPTH },
      { id: 's1_ww',  cx: -WALL_CX,    cy: BY, cz: 0,        width: bt,         height: bh, depth: EW_DEPTH },
      ...cellWalls,
    ],
  },
  {
    id: 'p1', name: "Player 1's Room",
    floorWidth: SUB_W, floorDepth: SUB_D, height: ROOM_H,
    cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
    geometry: subGeometry('s1_p1'),
  },
  {
    id: 'p2', name: "Player 2's Room",
    floorWidth: SUB_W, floorDepth: SUB_D, height: ROOM_H,
    cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
    geometry: subGeometry('s1_p2'),
  },
  {
    id: 'p3', name: "Player 3's Room",
    floorWidth: SUB_W, floorDepth: SUB_D, height: ROOM_H,
    cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
    geometry: subGeometry('s1_p3'),
  },
  {
    id: 'p4', name: "Player 4's Room",
    floorWidth: SUB_W, floorDepth: SUB_D, height: ROOM_H,
    cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
    geometry: subGeometry('s1_p4'),
  },
]

const SUB_IDS = ['p1', 'p2', 'p3', 'p4']

// Each sub-room's south wall midpoint (positionB=0.5) attaches to main's
// north wall at the circle's x — so BFS places each sub-room centered on
// its circle, 0.5 units north of main.
const CONNECTIONS: RoomConnection[] = VOTE_X.map((vx, i) => ({
  roomIdA: 'main', wallA: 'north', positionA: (vx + HW) / ROOM_W,
  roomIdB: SUB_IDS[i], wallB: 'south', positionB: 0.5,
  width: DOOR_W,
}))

const TOPOLOGY = { rooms: ROOMS, connections: CONNECTIONS }
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
  connections: CONNECTIONS,
  roomPositions: ARTIFACTS.roomPositions,
  cameraShapes: CAMERA_SHAPES,
  instructionSpecs: INSTRUCTION_SPECS,
  voteRegions: VOTE_REGIONS,
  npcs: [],
  getRoomAtPosition: ARTIFACTS.getRoomAtPosition,
  getAdjacentRoomIds: ARTIFACTS.getAdjacentRoomIds,
  isRoomOverlapping: ARTIFACTS.isRoomOverlapping,
}
