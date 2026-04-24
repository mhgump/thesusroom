import type { WorldSpec } from '../../../react-three-capacitor/src/game/WorldSpec.js'
import type { GameSpec } from '../../../react-three-capacitor/src/game/GameSpec.js'
import type { GameMap } from '../../../react-three-capacitor/src/game/GameMap.js'
import {
  computeRoomPositions,
  computeWalkableArea,
  validateWorldSpec,
} from '../../../react-three-capacitor/src/game/WorldSpec.js'
import { buildMapInstanceArtifacts } from '../../../react-three-capacitor/src/game/MapInstance.js'
import { buildCameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint.js'

const MAP_INSTANCE_ID = 'scenario4'

const CAPSULE_RADIUS = 0.0282
const bt = 0.025

const CTR_W  = 0.75
const CTR_D  = 0.75
const HALL_W = 0.25
const HALL_D = 0.75

// CTR_D = HALL_D = 0.75, so depth-derived values are shared across all three rooms
const HD        = CTR_D / 2              // 0.375
const C_HW      = CTR_W / 2             // 0.375
const H_HW      = HALL_W / 2            // 0.125
const WALL_C    = HD - bt / 2           // 0.3625  N/S wall centre z; E/W wall centre x for center
const EW_DEPTH  = 2 * (HD - bt)         // 0.700   E/W segment depth (both N/S walls present)
const D_HALF    = (HALL_W - 2 * bt) / 2 // 0.100   half the inset door gap
const D_SEG_CX  = (C_HW + D_HALF) / 2   // 0.2375  door-flanking segment centre x (center room)
const D_SEG_W   = C_HW - D_HALF         // 0.275   door-flanking segment width
const H_CX      = H_HW - bt / 2         // 0.1125  E/W wall centre x for halls; also corner cx

const WORLD_SPEC: WorldSpec = {
  rooms: [
    {
      id: 'center', name: 'Center',
      floorWidth: CTR_W, floorDepth: CTR_D,
      barrierHeight: bt, barrierThickness: bt,
      cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
      barrierSegments: [
        { cx: -D_SEG_CX, cz: -WALL_C,  width: D_SEG_W, depth: bt       }, // north-left
        { cx:  D_SEG_CX, cz: -WALL_C,  width: D_SEG_W, depth: bt       }, // north-right
        { cx: -D_SEG_CX, cz:  WALL_C,  width: D_SEG_W, depth: bt       }, // south-left
        { cx:  D_SEG_CX, cz:  WALL_C,  width: D_SEG_W, depth: bt       }, // south-right
        { cx:  WALL_C,   cz:  0,        width: bt,       depth: EW_DEPTH }, // east
        { cx: -WALL_C,   cz:  0,        width: bt,       depth: EW_DEPTH }, // west
      ],
    },
    {
      id: 'north_hall', name: 'North Hallway',
      floorWidth: HALL_W, floorDepth: HALL_D,
      barrierHeight: bt, barrierThickness: bt,
      cameraRect: { xMin: -HALL_W / 2, xMax: HALL_W / 2, zMin: -HALL_D / 2 + 0.5, zMax: HALL_D / 2 },
      barrierSegments: [
        { cx:  0,     cz: -WALL_C, width: HALL_W, depth: bt       }, // north (solid)
        { cx: -H_CX,  cz:  WALL_C, width: bt,      depth: bt       }, // south-left corner
        { cx:  H_CX,  cz:  WALL_C, width: bt,      depth: bt       }, // south-right corner
        { cx:  H_CX,  cz:  0,      width: bt,      depth: EW_DEPTH }, // east
        { cx: -H_CX,  cz:  0,      width: bt,      depth: EW_DEPTH }, // west
      ],
    },
    {
      id: 'south_hall', name: 'South Hallway',
      floorWidth: HALL_W, floorDepth: HALL_D,
      barrierHeight: bt, barrierThickness: bt,
      cameraRect: { xMin: -HALL_W / 2, xMax: HALL_W / 2, zMin: -HALL_D / 2, zMax: HALL_D / 2 - 0.5 },
      barrierSegments: [
        { cx: -H_CX,  cz: -WALL_C, width: bt,      depth: bt       }, // north-left corner
        { cx:  H_CX,  cz: -WALL_C, width: bt,      depth: bt       }, // north-right corner
        { cx:  0,     cz:  WALL_C, width: HALL_W, depth: bt       }, // south (solid)
        { cx:  H_CX,  cz:  0,      width: bt,      depth: EW_DEPTH }, // east
        { cx: -H_CX,  cz:  0,      width: bt,      depth: EW_DEPTH }, // west
      ],
    },
  ],
  connections: [
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
  ],
  visibility: {
    center:     ['north_hall', 'south_hall'],
    north_hall: ['center'],
    south_hall: ['center'],
  },
}

const LOCAL_POSITIONS = computeRoomPositions(WORLD_SPEC)
validateWorldSpec(WORLD_SPEC, LOCAL_POSITIONS)
const ARTIFACTS = buildMapInstanceArtifacts(WORLD_SPEC, MAP_INSTANCE_ID)
const ROOM_POSITIONS = ARTIFACTS.roomPositions
const CAMERA_SHAPES = buildCameraConstraintShapes(WORLD_SPEC, LOCAL_POSITIONS)
const WALKABLE = computeWalkableArea(WORLD_SPEC, LOCAL_POSITIONS, CAPSULE_RADIUS)

const GAME_SPEC: GameSpec = {
  instructionSpecs: [],
  voteRegions: [],
  geometry: [],
}

export const SCENARIO4_MAP: GameMap = {
  id: 'scenario4',
  mapInstanceId: MAP_INSTANCE_ID,
  worldSpec: WORLD_SPEC,
  roomPositions: ROOM_POSITIONS,
  cameraShapes: CAMERA_SHAPES,
  walkable: WALKABLE,
  gameSpec: GAME_SPEC,
  npcs: [],
  getRoomAtPosition: ARTIFACTS.getRoomAtPosition,
  getAdjacentRoomIds: ARTIFACTS.getAdjacentRoomIds,
  isRoomOverlapping: ARTIFACTS.isRoomOverlapping,
}
