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
// aren't currently inside them, so overlap is invisible at runtime. North
// of the four sub-rooms sits a fifth `final` room with the same dimensions
// as `main`; its south wall has matching doors at each VOTE_X so that
// after the 30s elimination, surviving players can walk through their
// sub-room into the final room.
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

function seg(id: string, left: number, right: number, cz: number, color?: string) {
  const cx = (left + right) / 2
  const width = right - left
  const base = { id, cx, cy: BY, cz, width, height: bh, depth: bt }
  return color ? { ...base, color } : base
}

const northSegments = [
  seg('s1_wnl1', -HW,                    VOTE_X[0] - D_HALF,   -WALL_CZ),
  seg('s1_d1',   VOTE_X[0] - D_HALF,     VOTE_X[0] + D_HALF,   -WALL_CZ, '#555555'),
  seg('s1_wnl2', VOTE_X[0] + D_HALF,     VOTE_X[1] - D_HALF,   -WALL_CZ),
  seg('s1_d2',   VOTE_X[1] - D_HALF,     VOTE_X[1] + D_HALF,   -WALL_CZ, '#555555'),
  seg('s1_wnl3', VOTE_X[1] + D_HALF,     -EX_HALF,             -WALL_CZ),
  seg('s1_wne',  -EX_HALF,               EX_HALF,              -WALL_CZ),
  seg('s1_wnr3', EX_HALF,                VOTE_X[2] - D_HALF,   -WALL_CZ),
  seg('s1_d3',   VOTE_X[2] - D_HALF,     VOTE_X[2] + D_HALF,   -WALL_CZ, '#555555'),
  seg('s1_wnr2', VOTE_X[2] + D_HALF,     VOTE_X[3] - D_HALF,   -WALL_CZ),
  seg('s1_d4',   VOTE_X[3] - D_HALF,     VOTE_X[3] + D_HALF,   -WALL_CZ, '#555555'),
  seg('s1_wnr1', VOTE_X[3] + D_HALF,     HW,                   -WALL_CZ),
]

// Sub-room: 0.5 × 0.5 box. South boundary is owned by main's north wall
// (the toggleable `s1_d{n}` door). North wall is a single segment that the
// scenario script drops once eliminations resolve so the sub-room opens
// into the `final` room.
const SUB_W = 0.5
const SUB_D = 0.5
const SUB_HD = SUB_D / 2
const SUB_HW = SUB_W / 2
const SUB_WALL_CZ = SUB_HD - bt / 2
const SUB_WALL_CX = SUB_HW - bt / 2
const SUB_EW_DEPTH = 2 * (SUB_HD - bt)

function subGeometry(prefix: string) {
  return [
    { id: `${prefix}_n`, cx: 0,             cy: BY, cz: -SUB_WALL_CZ, width: SUB_W,      height: bh, depth: bt, color: '#555555' },
    { id: `${prefix}_e`, cx:  SUB_WALL_CX,  cy: BY, cz: 0,            width: bt,         height: bh, depth: SUB_EW_DEPTH },
    { id: `${prefix}_w`, cx: -SUB_WALL_CX,  cy: BY, cz: 0,            width: bt,         height: bh, depth: SUB_EW_DEPTH },
  ]
}

// Final room: identical dimensions to main, sitting directly north of the
// four sub-rooms. South wall has four doors at the same VOTE_X positions
// as main's north (one per sub-room); the script drops them per-player as
// each player crosses out of their sub-room. North/east/west are solid.
// Final room's north wall: three segments split around a centred exit dock
// matching the initial hallway's width (HALL_W / EXIT_DOCK_W = 0.25). The
// scenario's `exitConnection` points at `s1_fwne` so the walk-out hallway
// attaches past the north edge of the final room (the actual terminal room
// players end up in), not main's north wall (which is blocked by the sub-
// rooms and the final room itself).
const finalNorthSegments = [
  seg('s1_fwnl', -HW,      -EX_HALF, -WALL_CZ),
  seg('s1_fwne', -EX_HALF,  EX_HALF, -WALL_CZ),
  seg('s1_fwnr',  EX_HALF,  HW,      -WALL_CZ),
]

const finalSouthSegments = [
  seg('s1_fwsl1', -HW,                    VOTE_X[0] - D_HALF, WALL_CZ),
  seg('s1_fd1',   VOTE_X[0] - D_HALF,     VOTE_X[0] + D_HALF, WALL_CZ, '#555555'),
  seg('s1_fwsl2', VOTE_X[0] + D_HALF,     VOTE_X[1] - D_HALF, WALL_CZ),
  seg('s1_fd2',   VOTE_X[1] - D_HALF,     VOTE_X[1] + D_HALF, WALL_CZ, '#555555'),
  seg('s1_fwsm',  VOTE_X[1] + D_HALF,     VOTE_X[2] - D_HALF, WALL_CZ),
  seg('s1_fd3',   VOTE_X[2] - D_HALF,     VOTE_X[2] + D_HALF, WALL_CZ, '#555555'),
  seg('s1_fwsr2', VOTE_X[2] + D_HALF,     VOTE_X[3] - D_HALF, WALL_CZ),
  seg('s1_fd4',   VOTE_X[3] - D_HALF,     VOTE_X[3] + D_HALF, WALL_CZ, '#555555'),
  seg('s1_fwsr1', VOTE_X[3] + D_HALF,     HW,                 WALL_CZ),
]

const ROOMS: RoomSpec[] = [
  {
    id: 'main', name: 'Scenario 1',
    floorWidthX: ROOM_W,
    floorDepthY: ROOM_D,
    height: ROOM_H,
    cameraExtentX: 0.4028, cameraExtentY: 0,
    transitionType: 'default',
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
    floorWidthX: SUB_W, floorDepthY: SUB_D, height: ROOM_H,
    cameraExtentX: 0, cameraExtentY: 0,
    transitionType: 'default',
    geometry: subGeometry('s1_p1'),
  },
  {
    id: 'p2', name: "Player 2's Room",
    floorWidthX: SUB_W, floorDepthY: SUB_D, height: ROOM_H,
    cameraExtentX: 0, cameraExtentY: 0,
    transitionType: 'default',
    geometry: subGeometry('s1_p2'),
  },
  {
    id: 'p3', name: "Player 3's Room",
    floorWidthX: SUB_W, floorDepthY: SUB_D, height: ROOM_H,
    cameraExtentX: 0, cameraExtentY: 0,
    transitionType: 'default',
    geometry: subGeometry('s1_p3'),
  },
  {
    id: 'p4', name: "Player 4's Room",
    floorWidthX: SUB_W, floorDepthY: SUB_D, height: ROOM_H,
    cameraExtentX: 0, cameraExtentY: 0,
    transitionType: 'default',
    geometry: subGeometry('s1_p4'),
  },
  {
    id: 'final', name: 'Final Room',
    floorWidthX: ROOM_W,
    floorDepthY: ROOM_D,
    height: ROOM_H,
    cameraExtentX: 0.4028, cameraExtentY: 0,
    transitionType: 'default',
    geometry: [
      ...finalSouthSegments,
      ...finalNorthSegments,
      { id: 's1_fwe', cx:  WALL_CX,    cy: BY, cz: 0,        width: bt,         height: bh, depth: EW_DEPTH },
      { id: 's1_fww', cx: -WALL_CX,    cy: BY, cz: 0,        width: bt,         height: bh, depth: EW_DEPTH },
    ],
  },
]

const SUB_IDS = ['p1', 'p2', 'p3', 'p4']

// Each sub-room's south wall midpoint (room2.position=0.5) attaches to main's
// north wall at the circle's x — so BFS places each sub-room centered on
// its circle, 0.5 units north of main. Each sub-room's north wall midpoint
// (room1.position=0.5) attaches to `final`'s south wall at the same circle x —
// BFS places `final` centered on x=0, 0.5 units north of the sub-rooms
// (final center world z = -1.25). All four sub→final connections agree on
// the same final position; validateWorldSpec will reject any drift.
const CONNECTIONS: RoomConnection[] = [
  ...VOTE_X.map((vx, i): RoomConnection => ({
    roomIdA: 'main',
    roomIdB: SUB_IDS[i],
    room1: { wall: 'north', length: DOOR_W, position: (vx + HW) / ROOM_W, transitionRegion: 'none' },
    room2: { wall: 'south', length: DOOR_W, position: 0.5,                 transitionRegion: 'none' },
  })),
  ...VOTE_X.map((vx, i): RoomConnection => ({
    roomIdA: SUB_IDS[i],
    roomIdB: 'final',
    room1: { wall: 'north', length: DOOR_W, position: 0.5,                 transitionRegion: 'none' },
    room2: { wall: 'south', length: DOOR_W, position: (vx + HW) / ROOM_W, transitionRegion: 'none' },
  })),
]

const TOPOLOGY = { rooms: ROOMS, connections: CONNECTIONS }
const LOCAL_POSITIONS = computeRoomPositions(TOPOLOGY)
validateWorldSpec(TOPOLOGY, LOCAL_POSITIONS)
const ARTIFACTS = buildMapInstanceArtifacts(TOPOLOGY, MAP_INSTANCE_ID)
const CAMERA_SHAPES = buildCameraConstraintShapes(TOPOLOGY, LOCAL_POSITIONS)

const INSTRUCTION_SPECS: InstructionEventSpec[] = [
  { id: 'find_instruction',    text: 'Find your circle',     label: 'COMMAND' },
  { id: 'subroom_instruction', text: 'Get to your room!',    label: 'COMMAND' },
  { id: 'final_instruction',   text: 'Move to the final room!', label: 'COMMAND' },
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
