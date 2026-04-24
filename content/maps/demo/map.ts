import type { WorldSpec } from '../../../react-three-capacitor/src/game/WorldSpec.js'
import type { GameSpec } from '../../../react-three-capacitor/src/game/GameSpec.js'
import type { GameMap } from '../../../react-three-capacitor/src/game/GameMap.js'
import {
  computeRoomPositions,
  validateWorldSpec,
} from '../../../react-three-capacitor/src/game/WorldSpec.js'
import { buildMapInstanceArtifacts } from '../../../react-three-capacitor/src/game/MapInstance.js'
import { buildCameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint.js'

const DEMO_MAP_INSTANCE_ID = 'demo'

const BT          = 0.025    // wall thickness & height
const BY          = BT / 2   // wall centre y (sitting on floor)
const ROOM_H      = 0.5
const DOOR_WIDTH  = 0.25

const R1W = 0.75, R1D = 0.75
const R2W = 0.75, R2D = 0.75
const R3W = 0.75, R3D = 0.75

const HW        = R1W / 2
const HD        = R1D / 2
const WALL_C    = HD - BT / 2
const EW_FULL   = 2 * (HD - BT)
const EW_EXT    = HD + (HD - BT)
const EW_CZ     = BT / 2
const D_HALF    = (DOOR_WIDTH - 2 * BT) / 2   // 0.1  half-width of the open gap between flanking walls
const D_SEG_CX  = (HW + D_HALF) / 2           // 0.2375
const D_SEG_W   = HW - D_HALF                 // 0.275
const DOOR_GAP_W = 2 * D_HALF                 // 0.2  width of the gap (and therefore of the door plug)

export const DEMO_WORLD_SPEC: WorldSpec = {
  rooms: [
    {
      id: 'room1', name: 'Room 1',
      floorWidth: R1W, floorDepth: R1D,
      height: ROOM_H,
      cameraRect: { xMin: -0.375, xMax: 0.375, zMin: -0.375, zMax: 0.375 },
      // south + E/W (E/W extend north so the north-east/west corners are sealed).
      // North boundary is owned by room2's south wall (authored on room2 below).
      geometry: [
        { id: 'r1_s', cx: 0,        cy: BY, cz:  WALL_C, width: R1W, height: BT, depth: BT },
        { id: 'r1_e', cx:  WALL_C,  cy: BY, cz: -EW_CZ,  width: BT,  height: BT, depth: EW_EXT },
        { id: 'r1_w', cx: -WALL_C,  cy: BY, cz: -EW_CZ,  width: BT,  height: BT, depth: EW_EXT },
      ],
    },
    {
      id: 'room2', name: 'Room 2',
      floorWidth: R2W, floorDepth: R2D,
      height: ROOM_H,
      cameraRect: { xMin: -0.375, xMax: 0.375, zMin: -0.375, zMax: 0.375 },
      // South (split at door gap for room1) + E/W (extend to north edge so
      // the corners are sealed even when room2_north_wall is absent).
      // room2_north_wall is the toggleable centre span of the north wall —
      // when dropped, the corners remain walled by r2_e/r2_w and only the
      // middle opens up so room3 appears to extend out of room2.
      // north_door is the toggleable plug in the south gap.
      geometry: [
        { id: 'r2_sl',             cx: -D_SEG_CX, cy: BY, cz:  WALL_C, width: D_SEG_W, height: BT, depth: BT },
        { id: 'r2_sr',             cx:  D_SEG_CX, cy: BY, cz:  WALL_C, width: D_SEG_W, height: BT, depth: BT },
        { id: 'r2_e',              cx:  WALL_C,   cy: BY, cz: -EW_CZ,  width: BT,      height: BT, depth: EW_EXT },
        { id: 'r2_w',              cx: -WALL_C,   cy: BY, cz: -EW_CZ,  width: BT,      height: BT, depth: EW_EXT },
        { id: 'north_door',        cx: 0,         cy: BY, cz:  WALL_C, width: DOOR_GAP_W, height: BT, depth: BT, color: '#555555' },
        { id: 'room2_north_wall',  cx: 0,         cy: BY, cz: -WALL_C, width: R2W - 2 * BT, height: BT, depth: BT },
      ],
    },
    {
      id: 'room3', name: 'Room 3',
      floorWidth: R3W, floorDepth: R3D,
      height: ROOM_H,
      cameraRect: { xMin: -0.375, xMax: 0.375, zMin: 0.125, zMax: 0.375 },
      // North + E/W. South boundary is owned by room2's north wall
      // (room2_north_wall) — room3 has no south wall of its own so it reads
      // as open-to-room2 once that toggleable wall drops.
      geometry: [
        { id: 'r3_n', cx: 0,       cy: BY, cz: -WALL_C, width: R3W, height: BT, depth: BT },
        { id: 'r3_e', cx:  WALL_C, cy: BY, cz:  EW_CZ,  width: BT,  height: BT, depth: EW_EXT },
        { id: 'r3_w', cx: -WALL_C, cy: BY, cz:  EW_CZ,  width: BT,  height: BT, depth: EW_EXT },
      ],
    },
  ],
  connections: [
    {
      roomIdA: 'room1', wallA: 'north', positionA: 0.5,
      roomIdB: 'room2', wallB: 'south', positionB: 0.5,
      width: DOOR_WIDTH,
      cameraTransition: {
        corners: [
          { x:  0,    z:  0     },
          { x:  0.05, z: -0.375 },
          { x: -0.05, z: -0.375 },
        ],
      },
    },
    {
      roomIdA: 'room2', wallA: 'north', positionA: 0.5,
      roomIdB: 'room3', wallB: 'south', positionB: 0.5,
      width: DOOR_WIDTH,
      cameraTransition: {
        corners: [
          { x:  0,    z:  0     },
          { x:  0.05, z: -0.375 },
          { x: -0.05, z: -0.375 },
        ],
      },
    },
  ],
}

const DEMO_LOCAL_POSITIONS = computeRoomPositions(DEMO_WORLD_SPEC)
validateWorldSpec(DEMO_WORLD_SPEC, DEMO_LOCAL_POSITIONS)
const DEMO_ARTIFACTS = buildMapInstanceArtifacts(DEMO_WORLD_SPEC, DEMO_MAP_INSTANCE_ID)
export const DEMO_ROOM_POSITIONS = DEMO_ARTIFACTS.roomPositions
export const DEMO_CAMERA_SHAPES = buildCameraConstraintShapes(DEMO_WORLD_SPEC, DEMO_LOCAL_POSITIONS)

export const DEMO_GAME_SPEC: GameSpec = {
  instructionSpecs: [
    { id: 'rule_move', text: 'Players that do not continue will be eliminated', label: 'RULE' },
    { id: 'fact_1',   text: '1 player survived',  label: 'FACT' },
    { id: 'fact_2',   text: '2 players survived', label: 'FACT' },
    { id: 'fact_3',   text: '3 players survived', label: 'FACT' },
    { id: 'fact_4',   text: '4 players survived', label: 'FACT' },
  ],
  voteRegions: [],
}

export const MAP: GameMap = {
  id: 'demo',
  mapInstanceId: DEMO_MAP_INSTANCE_ID,
  worldSpec: DEMO_WORLD_SPEC,
  roomPositions: DEMO_ROOM_POSITIONS,
  cameraShapes: DEMO_CAMERA_SHAPES,
  gameSpec: DEMO_GAME_SPEC,
  npcs: [],
  getRoomAtPosition: DEMO_ARTIFACTS.getRoomAtPosition,
  getAdjacentRoomIds: DEMO_ARTIFACTS.getAdjacentRoomIds,
  isRoomOverlapping: DEMO_ARTIFACTS.isRoomOverlapping,
}
