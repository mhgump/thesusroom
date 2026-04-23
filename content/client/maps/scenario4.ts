import type { WorldSpec } from '../../../react-three-capacitor/src/game/WorldSpec'
import type { GameSpec } from '../../../react-three-capacitor/src/game/GameSpec'
import type { ClientMap } from './registry'
import { computeRoomPositions, computeWalkableArea, getRoomAtPosition, validateWorldSpec } from '../../../react-three-capacitor/src/game/WorldSpec'
import { buildCameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint'

const CAPSULE_RADIUS = 0.0282

// All dimensions in world units where 1 unit = 1 screen height (ground-plane distance).
const CTR_W  = 0.75   // center room width  (0.75 × screen height)
const CTR_D  = 0.75   // center room depth
const HALL_W = 0.25   // hallway width
const HALL_D = 0.75   // hallway depth

export const S4_WORLD_SPEC: WorldSpec = {
  rooms: [
    {
      id: 'center', name: 'Center',
      floorWidth: CTR_W, floorDepth: CTR_D,
      barrierHeight: 0.0242, barrierThickness: 0.0242,
      // Camera is pinned to the room center — transition triangles handle the approach.
      cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
    },
    {
      id: 'north_hall', name: 'North Hallway',
      floorWidth: HALL_W, floorDepth: HALL_D,
      barrierHeight: 0.0242, barrierThickness: 0.0242,
      // zMin = -(HALL_D/2 - 0.5) ensures the top of screen never shows past the north wall.
      // Derivation: top_of_screen = camera_z - 0.5; north_wall_local = -HALL_D/2;
      //   camera_z >= -HALL_D/2 + 0.5  =>  zMin = -HALL_D/2 + 0.5 (room-local)
      cameraRect: { xMin: -HALL_W / 2, xMax: HALL_W / 2, zMin: -HALL_D / 2 + 0.5, zMax: HALL_D / 2 },
    },
    {
      id: 'south_hall', name: 'South Hallway',
      floorWidth: HALL_W, floorDepth: HALL_D,
      barrierHeight: 0.0242, barrierThickness: 0.0242,
      // zMax = HALL_D/2 - 0.5 ensures the bottom of screen never shows past the south wall.
      cameraRect: { xMin: -HALL_W / 2, xMax: HALL_W / 2, zMin: -HALL_D / 2, zMax: HALL_D / 2 - 0.5 },
    },
  ],
  connections: [
    {
      roomIdA: 'center', wallA: 'north', positionA: 0.5,
      roomIdB: 'north_hall', wallB: 'south', positionB: 0.5,
      width: HALL_W,
      // Triangle apex at center room's pinned camera point (0,0).
      // Base at the north wall edge (z = -CTR_D/2) spanning the full door width.
      // Base exactly meets north_hall's cameraRect south edge in world space.
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

export const S4_ROOM_POSITIONS = computeRoomPositions(S4_WORLD_SPEC)
validateWorldSpec(S4_WORLD_SPEC, S4_ROOM_POSITIONS)
export const S4_WALKABLE = computeWalkableArea(S4_WORLD_SPEC, S4_ROOM_POSITIONS, CAPSULE_RADIUS)
export const S4_CAMERA_SHAPES = buildCameraConstraintShapes(S4_WORLD_SPEC, S4_ROOM_POSITIONS)

function getS4RoomAtPosition(x: number, z: number): string {
  return getRoomAtPosition(S4_WORLD_SPEC, S4_ROOM_POSITIONS, x, z) ?? S4_WORLD_SPEC.rooms[0].id
}

export const S4_GAME_SPEC: GameSpec = {
  instructionSpecs: [],
  voteRegions: [],
  geometry: [],
}

export const SCENARIO4_CLIENT_MAP: ClientMap = {
  worldSpec: S4_WORLD_SPEC,
  roomPositions: S4_ROOM_POSITIONS,
  cameraShapes: S4_CAMERA_SHAPES,
  walkable: S4_WALKABLE,
  gameSpec: S4_GAME_SPEC,
  getRoomAtPosition: getS4RoomAtPosition,
}
