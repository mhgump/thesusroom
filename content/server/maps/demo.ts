import type { MapSpec } from '../../../react-three-capacitor/server/src/ScenarioRegistry.js'
import type { WalkableArea, PhysicsSpec } from '../../../react-three-capacitor/server/src/World.js'

const R1W = 1.2084, R1D = 1.2084
const R2W = 1.2084, R2D = 0.8056
const DOOR_WIDTH = 0.1611

const R1Z = 0
const R2Z = -1.0070

// ── Walkable rects (kept for AABB snap after door opens) ────────────────────
const R1_RECT   = { cx: 0, cz: 0,       hw: 0.5760, hd: 0.5760 }
const CONN_RECT = { cx: 0, cz: -0.6042, hw: 0.0524, hd: 0.0282 }
const R2_RECT   = { cx: 0, cz: -1.0070, hw: 0.5760, hd: 0.3746 }

export const DEFAULT_WALKABLE: WalkableArea = { rects: [R1_RECT] }
const BOTH_ROOMS: WalkableArea             = { rects: [R1_RECT, CONN_RECT, R2_RECT] }

// ── Rapier physics geometry ─────────────────────────────────────────────────
// Room edges (inner faces that capsules bounce off):
//   Room 1: x ∈ [-0.6042, 0.6042], z ∈ [-0.6042, 0.6042]
//   Room 2: x ∈ [-0.6042, 0.6042], z ∈ [-1.4098, -0.6042]
// Shared boundary at z = -0.6042: door gap x ∈ [-0.08055, 0.08055]

const ROOM_HW  = R1W / 2        // 0.6042 — half-width, same for both rooms
const R1_HD    = R1D / 2        // 0.6042 — room 1 half-depth
const R2_HD    = R2D / 2        // 0.4028 — room 2 half-depth
const R2_NORTH = R2Z - R2_HD   // -1.4098 — room 2 north inner face
const DOOR_HW  = DOOR_WIDTH / 2 // 0.08055 — door half-width
const WT       = 0.03           // collider half-thickness

// Derived positions
const SOUTH_WALL_CZ = R1_HD + WT           //  0.6342  inner face at z= 0.6042
const NORTH_WALL_CZ = R2_NORTH - WT        // -1.4398  inner face at z=-1.4098
const DOOR_WALL_CZ  = -(R1_HD + WT)        // -0.6342  inner face at z=-0.6042
const EAST_WALL_CX  = ROOM_HW + WT         //  0.6342  inner face at x= 0.6042
const COMB_CZ       = (R1_HD + R2_NORTH) / 2  // -0.4028 — east/west wall center z
const COMB_HD       = (R1_HD - R2_NORTH) / 2 + WT // 1.037  — east/west wall half-depth
const DW_CX         = (ROOM_HW + DOOR_HW) / 2  //  0.34238 — door-wall segment center x
const DW_HW         = (ROOM_HW - DOOR_HW) / 2  //  0.26183 — door-wall segment half-width

export const DEMO_PHYSICS: PhysicsSpec = {
  walls: [
    { cx: 0,           cz: SOUTH_WALL_CZ, hw: ROOM_HW + WT, hd: WT      }, // south
    { cx:  EAST_WALL_CX, cz: COMB_CZ,    hw: WT,           hd: COMB_HD }, // east (full height)
    { cx: -EAST_WALL_CX, cz: COMB_CZ,    hw: WT,           hd: COMB_HD }, // west (full height)
    { cx: -DW_CX,       cz: DOOR_WALL_CZ, hw: DW_HW,       hd: WT      }, // door wall — left
    { cx:  DW_CX,       cz: DOOR_WALL_CZ, hw: DW_HW,       hd: WT      }, // door wall — right
    { cx: 0,           cz: NORTH_WALL_CZ, hw: ROOM_HW + WT, hd: WT     }, // north
  ],
  toggles: [
    { id: 'north_door', cx: 0, cz: DOOR_WALL_CZ, hw: DOOR_HW, hd: WT },
  ],
}

// ── Room detection ────────────────────────────────────────────────────────────
function demoGetRoomAtPosition(x: number, z: number): string | null {
  const rooms = [
    { id: 'room1', cx: 0, cz: R1Z,  hw: R1W / 2, hd: R1D / 2 },
    { id: 'room2', cx: 0, cz: R2Z,  hw: R2W / 2, hd: R2D / 2 },
  ]
  for (const r of rooms) {
    if (Math.abs(x - r.cx) <= r.hw && Math.abs(z - r.cz) <= r.hd) return r.id
  }
  return null
}

export const DEMO_MAP: MapSpec = {
  id: 'demo',
  walkable: DEFAULT_WALKABLE,
  physics: DEMO_PHYSICS,
  walkableVariants: [
    { triggerIds: ['door_open'], walkable: BOTH_ROOMS },
  ],
  npcs: [],
  voteRegions: [],
  geometry: [
    { id: 'north_door', x: 0, z: -0.6042, width: 0.1611, depth: 0.0242, height: 0.0242, color: '#555555' },
    { id: 'door_open',  x: 0, z: -0.6042, width: 0.001,  depth: 0.001,  height: 0.001,  color: '#111111' },
  ],
  getRoomAtPosition: demoGetRoomAtPosition,
}
