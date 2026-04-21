import type { WorldSpec } from './WorldSpec'
import { computeRoomPositions, computeWalkableArea, getRoomAtPosition, validateWorldSpec } from './WorldSpec'
import { VIEWPORT_W, VIEWPORT_DEPTH } from './constants'

const CAPSULE_RADIUS = 0.35  // must match World.ts

export const DEFAULT_WORLD: WorldSpec = {
  rooms: [
    {
      id: 'room1', name: 'Room 1',
      floorWidth: VIEWPORT_W * 0.75,   // 15
      floorDepth: VIEWPORT_DEPTH * 0.75,
      barrierHeight: 0.3, barrierThickness: 0.3,
    },
    {
      id: 'room2', name: 'Room 2',
      floorWidth: VIEWPORT_W * 0.25,   // 5
      floorDepth: VIEWPORT_DEPTH,
      barrierHeight: 0.3, barrierThickness: 0.3,
      cameraRect: 'full',
    },
    {
      id: 'room3', name: 'Room 3',
      floorWidth: VIEWPORT_W * 2.0,    // 40
      floorDepth: VIEWPORT_DEPTH * 2.0,
      barrierHeight: 0.3, barrierThickness: 0.3,
    },
  ],
  connections: [
    // Room 1 north ↔ Room 2 south, centered; doorway = Room 2's full width
    {
      roomIdA: 'room1', wallA: 'north', positionA: 0.5,
      roomIdB: 'room2', wallB: 'south', positionB: 0.5,
      width: VIEWPORT_W * 0.25,
    },
    // Room 2 north ↔ Room 3 south, centered
    {
      roomIdA: 'room2', wallA: 'north', positionA: 0.5,
      roomIdB: 'room3', wallB: 'south', positionB: 0.5,
      width: VIEWPORT_W * 0.25,
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

// Returns the room id containing (x, z), falling back to room1.
export function getDefaultRoomAtPosition(x: number, z: number): string {
  return getRoomAtPosition(DEFAULT_WORLD, DEFAULT_ROOM_POSITIONS, x, z) ?? DEFAULT_WORLD.rooms[0].id
}
