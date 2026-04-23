import type { WorldSpec, WalkableArea } from '../../react-three-capacitor/src/game/WorldSpec.js'
import type { GameSpec } from '../../react-three-capacitor/src/game/GameSpec.js'
import type { GameMap } from '../../react-three-capacitor/src/game/GameMap.js'
import type { PhysicsSpec } from '../../react-three-capacitor/src/game/World.js'
import {
  computeRoomPositions,
  getRoomAtPosition,
  validateWorldSpec,
} from '../../react-three-capacitor/src/game/WorldSpec.js'
import { buildCameraConstraintShapes } from '../../react-three-capacitor/src/game/CameraConstraint.js'

const R           = 0.0282  // CAPSULE_RADIUS
const BT          = 0.0242  // barrierThickness
const DOOR_WIDTH  = 0.25

const R1W = 0.75, R1D = 0.75
const R2W = 0.75, R2D = 0.75
const R3W = 0.75, R3D = 0.75

const R1Z =  0
const R2Z = -0.75
const R3Z = -1.5

// ── WorldSpec ─────────────────────────────────────────────────────────────────

export const DEMO_WORLD_SPEC: WorldSpec = {
  rooms: [
    {
      id: 'room1', name: 'Room 1',
      floorWidth: R1W, floorDepth: R1D,
      barrierHeight: BT, barrierThickness: BT,
      cameraRect: { xMin: -0.375, xMax: 0.375, zMin: -0.375, zMax: 0.375 },
      disabledWalls: ['north' as const],
    },
    {
      id: 'room2', name: 'Room 2',
      floorWidth: R2W, floorDepth: R2D,
      barrierHeight: BT, barrierThickness: BT,
      cameraRect: { xMin: -0.375, xMax: 0.375, zMin: -0.375, zMax: 0.375 },
    },
    {
      id: 'room3', name: 'Room 3',
      floorWidth: R3W, floorDepth: R3D,
      barrierHeight: BT, barrierThickness: BT,
      cameraRect: { xMin: -0.375, xMax: 0.375, zMin: -0.375, zMax: 0.375 },
      disabledWalls: ['south' as const],
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
  visibility: {
    room1: ['room2'],
    room2: ['room3'],
    room3: [],
  },
}

export const DEMO_ROOM_POSITIONS = computeRoomPositions(DEMO_WORLD_SPEC)
validateWorldSpec(DEMO_WORLD_SPEC, DEMO_ROOM_POSITIONS)
export const DEMO_CAMERA_SHAPES = buildCameraConstraintShapes(DEMO_WORLD_SPEC, DEMO_ROOM_POSITIONS)

// ── Walkable areas ─────────────────────────────────────────────────────────────

const R1_RECT    = { cx: 0, cz: R1Z, hw: R1W / 2 - R, hd: R1D / 2 - R }  // { cx:0, cz:0,    hw:0.3468, hd:0.3468 }
const CONN_12    = { cx: 0, cz: R1Z - R1D / 2, hw: DOOR_WIDTH / 2 - R, hd: R }  // corridor room1→room2
const R2_RECT    = { cx: 0, cz: R2Z, hw: R2W / 2 - R, hd: R2D / 2 - R }  // { cx:0, cz:-0.75, hw:0.3468, hd:0.3468 }
const CONN_23    = { cx: 0, cz: R2Z - R2D / 2, hw: DOOR_WIDTH / 2 - R, hd: R }  // corridor room2→room3
const R3_RECT    = { cx: 0, cz: R3Z, hw: R3W / 2 - R, hd: R3D / 2 - R }  // { cx:0, cz:-1.5,  hw:0.3468, hd:0.3468 }

const ROOM1_ONLY:    WalkableArea = { rects: [R1_RECT] }
const BOTH_ROOMS:    WalkableArea = { rects: [R1_RECT, CONN_12, R2_RECT] }
const ALL_THREE:     WalkableArea = { rects: [R1_RECT, CONN_12, R2_RECT, CONN_23, R3_RECT] }

// ── Rapier physics ─────────────────────────────────────────────────────────────
//
// Room 1: x ∈ [-0.375, 0.375], z ∈ [-0.375, 0.375]
// Room 2: x ∈ [-0.375, 0.375], z ∈ [-1.125, -0.375]
// Room 3: x ∈ [-0.375, 0.375], z ∈ [-1.875, -1.125]
// Door gap (all three boundaries): x ∈ [-0.05, 0.05]

const ROOM_HW = R1W / 2          // 0.375
const WT       = 0.03             // collider half-thickness

const SOUTH_WALL_CZ   =  R1D / 2 + WT         //  0.405  — room1 south outer
const NORTH_WALL_R3_CZ = R3Z - R3D / 2 - WT   // -1.905  — room3 north outer

// East/west walls span all three rooms
const COMB_CZ  = (SOUTH_WALL_CZ + NORTH_WALL_R3_CZ) / 2  // -0.75
const COMB_HD  = (SOUTH_WALL_CZ - NORTH_WALL_R3_CZ) / 2  //  1.155

// Room1→Room2 boundary (z = -0.375)
const DOOR12_CZ = -(R1D / 2 + WT)    // -0.405
// Room2→Room3 boundary (z = -1.125)
const DOOR23_CZ = R2Z - R2D / 2 - WT // -1.155

const DOOR_HW = DOOR_WIDTH / 2        // 0.05
const DW_CX   = (ROOM_HW + DOOR_HW) / 2  // 0.2125
const DW_HW   = (ROOM_HW - DOOR_HW) / 2  // 0.1625

export const DEMO_PHYSICS: PhysicsSpec = {
  walls: [
    // Room 1 south
    { cx: 0,           cz:  SOUTH_WALL_CZ,   hw: ROOM_HW + WT, hd: WT      },
    // East / west (full height, all three rooms)
    { cx:  ROOM_HW + WT, cz: COMB_CZ,        hw: WT,           hd: COMB_HD },
    { cx: -(ROOM_HW + WT), cz: COMB_CZ,      hw: WT,           hd: COMB_HD },
    // Room1→Room2 door wall segments
    { cx: -DW_CX, cz: DOOR12_CZ, hw: DW_HW, hd: WT },
    { cx:  DW_CX, cz: DOOR12_CZ, hw: DW_HW, hd: WT },
    // Room2→Room3 door wall segments
    { cx: -DW_CX, cz: DOOR23_CZ, hw: DW_HW, hd: WT },
    { cx:  DW_CX, cz: DOOR23_CZ, hw: DW_HW, hd: WT },
    // Room 3 north
    { cx: 0, cz: NORTH_WALL_R3_CZ, hw: ROOM_HW + WT, hd: WT },
  ],
  geometry: [
    // Toggleable door between room1 and room2
    { id: 'north_door',       cx: 0, cz: DOOR12_CZ, hw: DOOR_HW, hd: WT },
    // Toggleable wall between room2 and room3
    { id: 'room2_north_wall', cx: 0, cz: DOOR23_CZ, hw: DOOR_HW, hd: WT },
  ],
}

// ── GameSpec (rendering geometry + instructions) ───────────────────────────────

// Visual z offsets for the door/wall geometry objects (centre of box, flush with boundary)
const NORTH_DOOR_VISUAL_Z      = -(R1D / 2 + BT / 2)       // -0.3871
const ROOM2_NORTH_WALL_VISUAL_Z = R2Z - R2D / 2 - BT / 2   // -1.1371

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
    // Room1→Room2 door
    { id: 'north_door',       x: 0, z: NORTH_DOOR_VISUAL_Z,       width: DOOR_WIDTH, depth: BT, height: BT, color: '#555555' },
    { id: 'door_open',        x: 0, z: -(R1D / 2),                width: 0.001,      depth: 0.001, height: 0.001, color: '#111111' },
    // Room2→Room3 wall
    { id: 'room2_north_wall', x: 0, z: ROOM2_NORTH_WALL_VISUAL_Z, width: DOOR_WIDTH, depth: BT, height: BT, color: '#555555' },
    // Invisible marker that activates the room3 walkable variant when shown
    { id: 'room3_accessible', x: 0, z: R3Z,                       width: 0.001,      depth: 0.001, height: 0.001, color: '#111111' },
  ],
}

// ── Unified map ────────────────────────────────────────────────────────────────

export const DEMO_MAP: GameMap = {
  id: 'demo',
  worldSpec: DEMO_WORLD_SPEC,
  roomPositions: DEMO_ROOM_POSITIONS,
  cameraShapes: DEMO_CAMERA_SHAPES,
  walkable: ROOM1_ONLY,
  physics: DEMO_PHYSICS,
  gameSpec: DEMO_GAME_SPEC,
  npcs: [],
  getRoomAtPosition: (x, z) => getRoomAtPosition(DEMO_WORLD_SPEC, DEMO_ROOM_POSITIONS, x, z),
  walkableVariants: [
    { triggerIds: ['door_open'],                           walkable: BOTH_ROOMS },
    { triggerIds: ['door_open', 'room3_accessible'],       walkable: ALL_THREE  },
  ],
}
