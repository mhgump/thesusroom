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

const CTR_W  = 0.75
const CTR_D  = 0.75
const HALL_W = 0.25
const HALL_D = 0.75

const HD        = CTR_D / 2
const C_HW      = CTR_W / 2
const H_HW      = HALL_W / 2
const WALL_C    = HD - bt / 2
const EW_DEPTH  = 2 * (HD - bt)
const D_HALF    = (HALL_W - 2 * bt) / 2
const D_SEG_CX  = (C_HW + D_HALF) / 2
const D_SEG_W   = C_HW - D_HALF
const H_CX      = H_HW - bt / 2

const ROOMS: RoomSpec[] = [
  {
    id: 'center', name: 'Center',
    floorWidth: CTR_W, floorDepth: CTR_D,
    height: ROOM_H,
    cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
    geometry: [
      { id: 's4_c_nl', cx: -D_SEG_CX, cy: BY, cz: -WALL_C, width: D_SEG_W, height: bh, depth: bt },
      { id: 's4_c_nr', cx:  D_SEG_CX, cy: BY, cz: -WALL_C, width: D_SEG_W, height: bh, depth: bt },
      { id: 's4_c_sl', cx: -D_SEG_CX, cy: BY, cz:  WALL_C, width: D_SEG_W, height: bh, depth: bt },
      { id: 's4_c_sr', cx:  D_SEG_CX, cy: BY, cz:  WALL_C, width: D_SEG_W, height: bh, depth: bt },
      { id: 's4_c_e',  cx:  WALL_C,   cy: BY, cz: 0,       width: bt,      height: bh, depth: EW_DEPTH },
      { id: 's4_c_w',  cx: -WALL_C,   cy: BY, cz: 0,       width: bt,      height: bh, depth: EW_DEPTH },
    ],
  },
  {
    id: 'north_hall', name: 'North Hallway',
    floorWidth: HALL_W, floorDepth: HALL_D,
    height: ROOM_H,
    cameraRect: { xMin: -HALL_W / 2, xMax: HALL_W / 2, zMin: -HALL_D / 2 + 0.5, zMax: HALL_D / 2 },
    geometry: [
      { id: 's4_n_n',  cx: 0,      cy: BY, cz: -WALL_C, width: HALL_W, height: bh, depth: bt },
      { id: 's4_n_sl', cx: -H_CX,  cy: BY, cz:  WALL_C, width: bt,     height: bh, depth: bt },
      { id: 's4_n_sr', cx:  H_CX,  cy: BY, cz:  WALL_C, width: bt,     height: bh, depth: bt },
      { id: 's4_n_e',  cx:  H_CX,  cy: BY, cz: 0,       width: bt,     height: bh, depth: EW_DEPTH },
      { id: 's4_n_w',  cx: -H_CX,  cy: BY, cz: 0,       width: bt,     height: bh, depth: EW_DEPTH },
    ],
  },
  {
    id: 'south_hall', name: 'South Hallway',
    floorWidth: HALL_W, floorDepth: HALL_D,
    height: ROOM_H,
    cameraRect: { xMin: -HALL_W / 2, xMax: HALL_W / 2, zMin: -HALL_D / 2, zMax: HALL_D / 2 - 0.5 },
    geometry: [
      { id: 's4_s_nl', cx: -H_CX,  cy: BY, cz: -WALL_C, width: bt,     height: bh, depth: bt },
      { id: 's4_s_nr', cx:  H_CX,  cy: BY, cz: -WALL_C, width: bt,     height: bh, depth: bt },
      { id: 's4_s_s',  cx: 0,      cy: BY, cz:  WALL_C, width: HALL_W, height: bh, depth: bt },
      { id: 's4_s_e',  cx:  H_CX,  cy: BY, cz: 0,       width: bt,     height: bh, depth: EW_DEPTH },
      { id: 's4_s_w',  cx: -H_CX,  cy: BY, cz: 0,       width: bt,     height: bh, depth: EW_DEPTH },
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
        { x:  0,          z:  0          },
        { x:  HALL_W / 2, z: -CTR_D / 2 },
        { x: -HALL_W / 2, z: -CTR_D / 2 },
      ],
    },
  },
  {
    roomIdA: 'center', wallA: 'south', positionA: 0.5,
    roomIdB: 'south_hall', wallB: 'north', positionB: 0.5,
    width: HALL_W,
    cameraTransition: {
      corners: [
        { x:  0,          z:  0         },
        { x:  HALL_W / 2, z: CTR_D / 2 },
        { x: -HALL_W / 2, z: CTR_D / 2 },
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
