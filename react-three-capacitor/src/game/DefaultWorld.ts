import type { WorldSpec } from './WorldSpec'
import { computeRoomPositions, computeWalkableArea, getRoomAtPosition, validateWorldSpec } from './WorldSpec'
import { buildCameraConstraintShapes } from './CameraConstraint'
import { VIEWPORT_W, VIEWPORT_DEPTH, ROOM_DEPTH } from './constants'

const CAPSULE_RADIUS = 0.35  // must match World.ts

export const DEFAULT_WORLD: WorldSpec = {
  rooms: [
    {
      id: 'room1', name: 'Room 1',
      floorWidth: VIEWPORT_W * 0.75,   // 15
      floorDepth: VIEWPORT_DEPTH * 0.75,
      barrierHeight: 0.3, barrierThickness: 0.3,
      // Room is narrower than the viewport — camera stays fixed at room centre.
      cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
    },
    {
      id: 'room2', name: 'Room 2',
      floorWidth: VIEWPORT_W * 0.25,   // 5
      floorDepth: VIEWPORT_DEPTH,
      barrierHeight: 0.3, barrierThickness: 0.3,
      // Corridor narrower than the viewport — track the full floor width.
      cameraRect: {
        xMin: -VIEWPORT_W * 0.125, xMax: VIEWPORT_W * 0.125,
        zMin: -VIEWPORT_DEPTH / 2,  zMax: VIEWPORT_DEPTH / 2,
      },
    },
    {
      id: 'room3', name: 'Room 3',
      floorWidth: VIEWPORT_W * 2.0,    // 40
      floorDepth: VIEWPORT_DEPTH * 2.0,
      barrierHeight: 0.3, barrierThickness: 0.3,
      // Large room — constrain camera so the viewport edge stays inside the floor.
      cameraRect: {
        xMin: -VIEWPORT_W / 2, xMax: VIEWPORT_W / 2,
        zMin: -VIEWPORT_DEPTH / 2, zMax: VIEWPORT_DEPTH / 2,
      },
    },
  ],
  connections: [
    // Room 1 north ↔ Room 2 south, centered; doorway = Room 2's full width.
    // Transition: triangle bridging room1's centre point to room2's south camera rect edge.
    // Corners are in room1-local coordinates (room1 is at world origin).
    {
      roomIdA: 'room1', wallA: 'north', positionA: 0.5,
      roomIdB: 'room2', wallB: 'south', positionB: 0.5,
      width: VIEWPORT_W * 0.25,
      cameraTransition: {
        corners: [
          { x: 0,                  z: 0            },   // room1 camera rect (point)
          { x:  VIEWPORT_W * 0.125, z: -ROOM_DEPTH / 2 },  // room2 rect SE
          { x: -VIEWPORT_W * 0.125, z: -ROOM_DEPTH / 2 },  // room2 rect SW
        ],
      },
    },
    // Room 2 north ↔ Room 3 south, centered.
    // Transition: trapezoid bridging room2's north camera rect edge to room3's south edge.
    // Corners are in room2-local coordinates (origin at room2 centre).
    {
      roomIdA: 'room2', wallA: 'north', positionA: 0.5,
      roomIdB: 'room3', wallB: 'south', positionB: 0.5,
      width: VIEWPORT_W * 0.25,
      cameraTransition: {
        corners: [
          { x: -VIEWPORT_W * 0.125, z: -VIEWPORT_DEPTH / 2 },  // room2 rect NW
          { x:  VIEWPORT_W * 0.125, z: -VIEWPORT_DEPTH / 2 },  // room2 rect NE
          { x:  VIEWPORT_W / 2,     z: -VIEWPORT_DEPTH      },  // room3 rect SE (room2-local)
          { x: -VIEWPORT_W / 2,     z: -VIEWPORT_DEPTH      },  // room3 rect SW (room2-local)
        ],
      },
    },
  ],
  visibility: {
    room1: ['room2'],
    room2: ['room1', 'room3'],
    room3: [],
  },
}

export const DEFAULT_ROOM_POSITIONS = computeRoomPositions(DEFAULT_WORLD)
validateWorldSpec(DEFAULT_WORLD, DEFAULT_ROOM_POSITIONS)
export const DEFAULT_WALKABLE = computeWalkableArea(DEFAULT_WORLD, DEFAULT_ROOM_POSITIONS, CAPSULE_RADIUS)
export const DEFAULT_CAMERA_SHAPES = buildCameraConstraintShapes(DEFAULT_WORLD, DEFAULT_ROOM_POSITIONS)

// Returns the room id containing (x, z), falling back to room1.
export function getDefaultRoomAtPosition(x: number, z: number): string {
  return getRoomAtPosition(DEFAULT_WORLD, DEFAULT_ROOM_POSITIONS, x, z) ?? DEFAULT_WORLD.rooms[0].id
}
