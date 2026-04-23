import type { WorldSpec, WalkableArea } from '../../../react-three-capacitor/src/game/WorldSpec'
import type { GameSpec } from '../../../react-three-capacitor/src/game/GameSpec'
import type { ClientMap } from './registry'
import type { PhysicsSpec } from '../../../react-three-capacitor/src/game/World'
import { computeRoomPositions, getRoomAtPosition, validateWorldSpec } from '../../../react-three-capacitor/src/game/WorldSpec'
import { buildCameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint'

const R = 0.0282   // CAPSULE_RADIUS — must match World.ts
const BT = 0.0242  // barrierThickness — must match WorldSpec room definitions

const R1W = 1.2084, R1D = 1.2084
const R2W = 1.2084, R2D = 0.8056
const DOOR_WIDTH = 0.1611

const R1Z = 0
const R2Z = -1.0070

export const DEMO_WORLD_SPEC: WorldSpec = {
  rooms: [
    {
      id: 'room1', name: 'Room 1',
      floorWidth: R1W, floorDepth: R1D,
      barrierHeight: 0.0242, barrierThickness: 0.0242,
      cameraRect: { xMin: -0.6042, xMax: 0.6042, zMin: -0.6042, zMax: 0.6042 },
      disabledWalls: ['north' as const],
    },
    {
      id: 'room2', name: 'Room 2',
      floorWidth: R2W, floorDepth: R2D,
      barrierHeight: 0.0242, barrierThickness: 0.0242,
      cameraRect: { xMin: -0.6042, xMax: 0.6042, zMin: 0.0972, zMax: 0.4028 },
    },
  ],
  connections: [
    {
      roomIdA: 'room1', wallA: 'north', positionA: 0.5,
      roomIdB: 'room2', wallB: 'south', positionB: 0.5,
      width: DOOR_WIDTH,
      cameraTransition: {
        corners: [
          { x:  0,              z:  0        },
          { x:  0.0806,         z: -0.6042   },
          { x: -0.0806,         z: -0.6042   },
        ],
      },
    },
  ],
  visibility: {
    room1: ['room2'],
    room2: [],
  },
}

export const DEMO_ROOM_POSITIONS = computeRoomPositions(DEMO_WORLD_SPEC)
validateWorldSpec(DEMO_WORLD_SPEC, DEMO_ROOM_POSITIONS)
export const DEMO_CAMERA_SHAPES = buildCameraConstraintShapes(DEMO_WORLD_SPEC, DEMO_ROOM_POSITIONS)

export function getDemoRoomAtPosition(x: number, z: number): string {
  return getRoomAtPosition(DEMO_WORLD_SPEC, DEMO_ROOM_POSITIONS, x, z) ?? DEMO_WORLD_SPEC.rooms[0].id
}

// ── Walkable rects (AABB fallback for non-Rapier maps) ───────────────────────
const R1_RECT   = { cx: 0, cz: 0,       hw: 0.5760, hd: 0.5760 }
const CONN_RECT = { cx: 0, cz: -0.6042, hw: 0.0524, hd: 0.0282 }
const R2_RECT   = { cx: 0, cz: -1.0070, hw: 0.5760, hd: 0.3746 }

const ROOM1_ONLY: WalkableArea = { rects: [R1_RECT] }
const BOTH_ROOMS: WalkableArea = { rects: [R1_RECT, CONN_RECT, R2_RECT] }

// ── Rapier physics geometry (mirrors content/server/maps/demo.ts) ─────────────
const ROOM_HW  = R1W / 2        // 0.6042
const R1_HD    = R1D / 2        // 0.6042
const R2_HD    = R2D / 2        // 0.4028
const R2_NORTH = R2Z - R2_HD   // -1.4098
const DOOR_HW_HALF = DOOR_WIDTH / 2  // 0.08055
const WT       = 0.03

const SOUTH_WALL_CZ = R1_HD + WT
const NORTH_WALL_CZ = R2_NORTH - WT
const DOOR_WALL_CZ  = -(R1_HD + WT)
const EAST_WALL_CX  = ROOM_HW + WT
const COMB_CZ       = (R1_HD + R2_NORTH) / 2
const COMB_HD       = (R1_HD - R2_NORTH) / 2 + WT
const DW_CX         = (ROOM_HW + DOOR_HW_HALF) / 2
const DW_HW         = (ROOM_HW - DOOR_HW_HALF) / 2

export const DEMO_PHYSICS: PhysicsSpec = {
  walls: [
    { cx: 0,           cz: SOUTH_WALL_CZ, hw: ROOM_HW + WT, hd: WT      },
    { cx:  EAST_WALL_CX, cz: COMB_CZ,    hw: WT,           hd: COMB_HD },
    { cx: -EAST_WALL_CX, cz: COMB_CZ,    hw: WT,           hd: COMB_HD },
    { cx: -DW_CX,       cz: DOOR_WALL_CZ, hw: DW_HW,       hd: WT      },
    { cx:  DW_CX,       cz: DOOR_WALL_CZ, hw: DW_HW,       hd: WT      },
    { cx: 0,           cz: NORTH_WALL_CZ, hw: ROOM_HW + WT, hd: WT     },
  ],
  toggles: [
    { id: 'north_door', cx: 0, cz: DOOR_WALL_CZ, hw: DOOR_HW_HALF, hd: WT },
  ],
}

// ── Game spec ─────────────────────────────────────────────────────────────────
export const DEMO_GAME_SPEC: GameSpec = {
  instructionSpecs: [
    { id: 'rule_move', text: 'Players that do not continue will be eliminated', label: 'RULE' },
    { id: 'fact_1',   text: '1 player survived',  label: 'FACT' },
    { id: 'fact_2',   text: '2 players survived', label: 'FACT' },
    { id: 'fact_3',   text: '3 players survived', label: 'FACT' },
    { id: 'fact_4',   text: '4 players survived', label: 'FACT' },
  ],
  voteRegions: [],
  geometry: [
    { id: 'north_door', x: 0, z: -0.6042, width: 0.1611, depth: 0.0242, height: 0.0242, color: '#555555' },
    { id: 'door_open',  x: 0, z: -0.6042, width: 0.001,  depth: 0.001,  height: 0.001,  color: '#111111' },
  ],
}

export const DEMO_CLIENT_MAP: ClientMap = {
  worldSpec: DEMO_WORLD_SPEC,
  roomPositions: DEMO_ROOM_POSITIONS,
  cameraShapes: DEMO_CAMERA_SHAPES,
  walkable: ROOM1_ONLY,
  physics: DEMO_PHYSICS,
  gameSpec: DEMO_GAME_SPEC,
  getRoomAtPosition: getDemoRoomAtPosition,
  walkableVariants: [
    { triggerIds: ['door_open'], walkable: BOTH_ROOMS },
  ],
}
