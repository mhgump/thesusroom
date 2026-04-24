import type { GameMap } from '../../../react-three-capacitor/src/game/GameMap.js'
import type { RoomSpec } from '../../../react-three-capacitor/src/game/RoomSpec.js'
import type { RoomConnection } from '../../../react-three-capacitor/src/game/WorldSpec.js'
import {
  computeRoomPositions,
  validateWorldSpec,
} from '../../../react-three-capacitor/src/game/WorldSpec.js'
import { buildMapInstanceArtifacts } from '../../../react-three-capacitor/src/game/MapInstance.js'
import { buildCameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint.js'

const MAP_INSTANCE_ID = 'scenario4'

const bt = 0.025
const bh = 0.025
const BY = bh / 2
const ROOM_H = 0.5

// Center is the scenario's entry room — a 0.75 × 0.75 square with a 3-way
// split on its south wall (flanking segments + hub dock), mirroring the
// scenario1/2/3 dock pattern. A narrow corridor (north_hall) runs north
// off center.
//
// Previously the scenario's hub docked onto a 0.25-wide south_hall
// directly — a room whose full south wall was the dock. Arriving players
// got stuck at the south-hall/center boundary because the narrow hallway
// gave resolveOverlap no usable clearance when maybeReleaseHubTransfer
// restored the dock geometry right as the player crossed in. Replacing
// the entry room with the wider center room (same pattern as the other
// scenarios) eliminates that pinch point.
const CTR_W  = 0.75
const CTR_D  = 0.75
const HALL_W = 0.25
const HALL_D = 0.75

const C_HD      = CTR_D / 2
const C_HW      = CTR_W / 2
const H_HW      = HALL_W / 2
const C_WALL_C  = C_HD - bt / 2
const H_WALL_C  = HALL_D / 2 - bt / 2
const C_EW_DEPTH = 2 * (C_HD - bt)
const H_EW_DEPTH = 2 * (HALL_D / 2 - bt)

// Center's south wall split — middle 0.25 segment is the hub dock.
const HUB_DOCK_W = HALL_W
const S_SIDE_W   = (CTR_W - HUB_DOCK_W) / 2
const S_SIDE_CX  = (CTR_W + HUB_DOCK_W) / 4

// Center's north wall split — middle 0.25 segment opens into north_hall.
// Flanking segments sit either side of the doorway so the north corners
// stay walled.
const N_OPEN_W  = HALL_W
const N_SIDE_W  = (CTR_W - N_OPEN_W) / 2
const N_SIDE_CX = (CTR_W + N_OPEN_W) / 4

// North hallway — thin corridor running off center's north wall.
const H_CX = H_HW - bt / 2

const ROOMS: RoomSpec[] = [
  {
    id: 'center', name: 'Center',
    floorWidth: CTR_W, floorDepth: CTR_D,
    height: ROOM_H,
    cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
    geometry: [
      // North wall — flanking solid segments; the 0.25 doorway in the
      // middle is intentionally absent (the connection to north_hall fills
      // that span).
      { id: 's4_c_nl', cx: -N_SIDE_CX, cy: BY, cz: -C_WALL_C, width: N_SIDE_W,  height: bh, depth: bt },
      { id: 's4_c_nr', cx:  N_SIDE_CX, cy: BY, cz: -C_WALL_C, width: N_SIDE_W,  height: bh, depth: bt },
      // South wall — flanking solid segments + hub dock in the middle.
      { id: 's4_c_sl', cx: -S_SIDE_CX, cy: BY, cz:  C_WALL_C, width: S_SIDE_W,  height: bh, depth: bt },
      { id: 's4_c_s',  cx: 0,          cy: BY, cz:  C_WALL_C, width: HUB_DOCK_W, height: bh, depth: bt },
      { id: 's4_c_sr', cx:  S_SIDE_CX, cy: BY, cz:  C_WALL_C, width: S_SIDE_W,  height: bh, depth: bt },
      { id: 's4_c_e',  cx:  C_WALL_C,  cy: BY, cz: 0,         width: bt,        height: bh, depth: C_EW_DEPTH },
      { id: 's4_c_w',  cx: -C_WALL_C,  cy: BY, cz: 0,         width: bt,        height: bh, depth: C_EW_DEPTH },
    ],
  },
  {
    id: 'north_hall', name: 'North Hallway',
    floorWidth: HALL_W, floorDepth: HALL_D,
    height: ROOM_H,
    cameraRect: { xMin: -HALL_W / 2, xMax: HALL_W / 2, zMin: -HALL_D / 2 + 0.5, zMax: HALL_D / 2 },
    geometry: [
      { id: 's4_n_n',  cx: 0,      cy: BY, cz: -H_WALL_C, width: HALL_W, height: bh, depth: bt },
      { id: 's4_n_sl', cx: -H_CX,  cy: BY, cz:  H_WALL_C, width: bt,     height: bh, depth: bt },
      { id: 's4_n_sr', cx:  H_CX,  cy: BY, cz:  H_WALL_C, width: bt,     height: bh, depth: bt },
      { id: 's4_n_e',  cx:  H_CX,  cy: BY, cz: 0,         width: bt,     height: bh, depth: H_EW_DEPTH },
      { id: 's4_n_w',  cx: -H_CX,  cy: BY, cz: 0,         width: bt,     height: bh, depth: H_EW_DEPTH },
    ],
  },
]

const CONNECTIONS: RoomConnection[] = [
  {
    roomIdA: 'center', wallA: 'north', positionA: 0.5,
    roomIdB: 'north_hall', wallB: 'south', positionB: 0.5,
    width: HALL_W,
    cameraTransition: {
      corners: [
        { x:  0,          z:  0         },
        { x:  HALL_W / 2, z: -CTR_D / 2 },
        { x: -HALL_W / 2, z: -CTR_D / 2 },
      ],
    },
  },
]

const TOPOLOGY = { rooms: ROOMS, connections: CONNECTIONS }
const LOCAL_POSITIONS = computeRoomPositions(TOPOLOGY)
validateWorldSpec(TOPOLOGY, LOCAL_POSITIONS)
const ARTIFACTS = buildMapInstanceArtifacts(TOPOLOGY, MAP_INSTANCE_ID)
const CAMERA_SHAPES = buildCameraConstraintShapes(TOPOLOGY, LOCAL_POSITIONS)

export const MAP: GameMap = {
  id: 'scenario4',
  mapInstanceId: MAP_INSTANCE_ID,
  rooms: ROOMS,
  connections: CONNECTIONS,
  roomPositions: ARTIFACTS.roomPositions,
  cameraShapes: CAMERA_SHAPES,
  instructionSpecs: [],
  voteRegions: [],
  npcs: [],
  getRoomAtPosition: ARTIFACTS.getRoomAtPosition,
  getAdjacentRoomIds: ARTIFACTS.getAdjacentRoomIds,
  isRoomOverlapping: ARTIFACTS.isRoomOverlapping,
}
