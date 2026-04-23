import type { WorldSpec } from '../../react-three-capacitor/src/game/WorldSpec.js'
import type { GameSpec } from '../../react-three-capacitor/src/game/GameSpec.js'
import type { GameMap } from '../../react-three-capacitor/src/game/GameMap.js'
import {
  computeRoomPositions,
  computeWalkableArea,
  getRoomAtPosition,
  validateWorldSpec,
} from '../../react-three-capacitor/src/game/WorldSpec.js'
import { buildCameraConstraintShapes } from '../../react-three-capacitor/src/game/CameraConstraint.js'

const CAPSULE_RADIUS = 0.0282

const CTR_W  = 0.75
const CTR_D  = 0.75
const HALL_W = 0.25
const HALL_D = 0.75

const WORLD_SPEC: WorldSpec = {
  rooms: [
    {
      id: 'center', name: 'Center',
      floorWidth: CTR_W, floorDepth: CTR_D,
      barrierHeight: 0.0242, barrierThickness: 0.0242,
      cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
    },
    {
      id: 'north_hall', name: 'North Hallway',
      floorWidth: HALL_W, floorDepth: HALL_D,
      barrierHeight: 0.0242, barrierThickness: 0.0242,
      cameraRect: { xMin: -HALL_W / 2, xMax: HALL_W / 2, zMin: -HALL_D / 2 + 0.5, zMax: HALL_D / 2 },
    },
    {
      id: 'south_hall', name: 'South Hallway',
      floorWidth: HALL_W, floorDepth: HALL_D,
      barrierHeight: 0.0242, barrierThickness: 0.0242,
      cameraRect: { xMin: -HALL_W / 2, xMax: HALL_W / 2, zMin: -HALL_D / 2, zMax: HALL_D / 2 - 0.5 },
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

const ROOM_POSITIONS = computeRoomPositions(WORLD_SPEC)
validateWorldSpec(WORLD_SPEC, ROOM_POSITIONS)
const CAMERA_SHAPES = buildCameraConstraintShapes(WORLD_SPEC, ROOM_POSITIONS)
const WALKABLE = computeWalkableArea(WORLD_SPEC, ROOM_POSITIONS, CAPSULE_RADIUS)

const GAME_SPEC: GameSpec = {
  instructionSpecs: [],
  voteRegions: [],
  geometry: [],
}

export const SCENARIO4_MAP: GameMap = {
  id: 'scenario4',
  worldSpec: WORLD_SPEC,
  roomPositions: ROOM_POSITIONS,
  cameraShapes: CAMERA_SHAPES,
  walkable: WALKABLE,
  gameSpec: GAME_SPEC,
  npcs: [],
  getRoomAtPosition: (x, z) => getRoomAtPosition(WORLD_SPEC, ROOM_POSITIONS, x, z),
}
