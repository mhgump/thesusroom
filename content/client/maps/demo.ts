import type { WorldSpec } from '../../../react-three-capacitor/src/game/WorldSpec'
import type { GameSpec } from '../../../react-three-capacitor/src/game/GameSpec'
import type { ClientMap } from './registry'
import { computeRoomPositions, computeWalkableArea, getRoomAtPosition, validateWorldSpec } from '../../../react-three-capacitor/src/game/WorldSpec'
import { buildCameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint'
import { VIEWPORT_W, VIEWPORT_DEPTH, ROOM_DEPTH } from '../../../react-three-capacitor/src/game/constants'

const CAPSULE_RADIUS = 0.35  // must match server World.ts

export const DEMO_WORLD_SPEC: WorldSpec = {
  rooms: [
    {
      id: 'room1', name: 'Room 1',
      floorWidth: VIEWPORT_W * 0.75,
      floorDepth: VIEWPORT_DEPTH * 0.75,
      barrierHeight: 0.3, barrierThickness: 0.3,
      cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
    },
    {
      id: 'room2', name: 'Room 2',
      floorWidth: VIEWPORT_W * 0.25,
      floorDepth: VIEWPORT_DEPTH,
      barrierHeight: 0.3, barrierThickness: 0.3,
      cameraRect: {
        xMin: -VIEWPORT_W * 0.125, xMax: VIEWPORT_W * 0.125,
        zMin: -VIEWPORT_DEPTH / 2,  zMax: VIEWPORT_DEPTH / 2,
      },
    },
    {
      id: 'room3', name: 'Room 3',
      floorWidth: VIEWPORT_W * 2.0,
      floorDepth: VIEWPORT_DEPTH * 2.0,
      barrierHeight: 0.3, barrierThickness: 0.3,
      cameraRect: {
        xMin: -VIEWPORT_W / 2, xMax: VIEWPORT_W / 2,
        zMin: -VIEWPORT_DEPTH / 2, zMax: VIEWPORT_DEPTH / 2,
      },
    },
    {
      id: 'south_hall', name: 'South Hall',
      floorWidth: VIEWPORT_W * 0.25,
      floorDepth: VIEWPORT_DEPTH,
      barrierHeight: 0.3, barrierThickness: 0.3,
      cameraRect: {
        xMin: -VIEWPORT_W * 0.125, xMax: VIEWPORT_W * 0.125,
        zMin: -VIEWPORT_DEPTH / 2,  zMax: VIEWPORT_DEPTH / 2,
      },
    },
    {
      id: 'south_room', name: 'South Room',
      floorWidth: VIEWPORT_W,
      floorDepth: VIEWPORT_DEPTH,
      barrierHeight: 0.3, barrierThickness: 0.3,
      cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
    },
  ],
  connections: [
    {
      roomIdA: 'room1', wallA: 'north', positionA: 0.5,
      roomIdB: 'room2', wallB: 'south', positionB: 0.5,
      width: VIEWPORT_W * 0.25,
      cameraTransition: {
        corners: [
          { x: 0,                   z: 0             },
          { x:  VIEWPORT_W * 0.125, z: -ROOM_DEPTH / 2 },
          { x: -VIEWPORT_W * 0.125, z: -ROOM_DEPTH / 2 },
        ],
      },
    },
    {
      roomIdA: 'room2', wallA: 'north', positionA: 0.5,
      roomIdB: 'room3', wallB: 'south', positionB: 0.5,
      width: VIEWPORT_W * 0.25,
      cameraTransition: {
        corners: [
          { x: -VIEWPORT_W * 0.125, z: -VIEWPORT_DEPTH / 2 },
          { x:  VIEWPORT_W * 0.125, z: -VIEWPORT_DEPTH / 2 },
          { x:  VIEWPORT_W / 2,     z: -VIEWPORT_DEPTH      },
          { x: -VIEWPORT_W / 2,     z: -VIEWPORT_DEPTH      },
        ],
      },
    },
    {
      roomIdA: 'room1', wallA: 'south', positionA: 0.5,
      roomIdB: 'south_hall', wallB: 'north', positionB: 0.5,
      width: VIEWPORT_W * 0.25,
      cameraTransition: {
        corners: [
          { x:  0,                   z:  0              },
          { x:  VIEWPORT_W * 0.125,  z: +ROOM_DEPTH / 2 },
          { x: -VIEWPORT_W * 0.125,  z: +ROOM_DEPTH / 2 },
        ],
      },
    },
    {
      roomIdA: 'south_hall', wallA: 'south', positionA: 0.5,
      roomIdB: 'south_room', wallB: 'north', positionB: 0.5,
      width: VIEWPORT_W * 0.25,
      cameraTransition: {
        corners: [
          { x: -VIEWPORT_W * 0.125, z: +VIEWPORT_DEPTH / 2 },
          { x:  VIEWPORT_W * 0.125, z: +VIEWPORT_DEPTH / 2 },
          { x:  0,                   z: +VIEWPORT_DEPTH      },
        ],
      },
    },
  ],
  visibility: {
    room1:      ['room2', 'south_hall'],
    room2:      ['room1', 'room3'],
    room3:      [],
    south_hall: ['room1', 'south_room'],
    south_room: [],
  },
}

export const DEMO_ROOM_POSITIONS = computeRoomPositions(DEMO_WORLD_SPEC)
validateWorldSpec(DEMO_WORLD_SPEC, DEMO_ROOM_POSITIONS)
export const DEMO_WALKABLE = computeWalkableArea(DEMO_WORLD_SPEC, DEMO_ROOM_POSITIONS, CAPSULE_RADIUS)
export const DEMO_CAMERA_SHAPES = buildCameraConstraintShapes(DEMO_WORLD_SPEC, DEMO_ROOM_POSITIONS)

export function getDemoRoomAtPosition(x: number, z: number): string {
  return getRoomAtPosition(DEMO_WORLD_SPEC, DEMO_ROOM_POSITIONS, x, z) ?? DEMO_WORLD_SPEC.rooms[0].id
}

const southRoom = DEMO_ROOM_POSITIONS.get('south_room')!

export const DEMO_GAME_SPEC: GameSpec = {
  instructionSpecs: [
    { id: 'vote_instruction', text: 'Vote Yes or No', label: 'COMMAND' },
  ],
  voteRegions: [
    { id: 'vote_yes', label: 'Yes', color: '#2ecc71', x: southRoom.x - 5, z: southRoom.z, radius: 3 },
    { id: 'vote_no',  label: 'No',  color: '#e74c3c', x: southRoom.x + 5, z: southRoom.z, radius: 3 },
  ],
  geometry: [],
}

export const DEMO_CLIENT_MAP: ClientMap = {
  worldSpec: DEMO_WORLD_SPEC,
  roomPositions: DEMO_ROOM_POSITIONS,
  cameraShapes: DEMO_CAMERA_SHAPES,
  walkable: DEMO_WALKABLE,
  gameSpec: DEMO_GAME_SPEC,
  getRoomAtPosition: getDemoRoomAtPosition,
}
