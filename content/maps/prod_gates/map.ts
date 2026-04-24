import type { GameMap } from '../../../react-three-capacitor/src/game/GameMap.js'
import type { RoomSpec } from '../../../react-three-capacitor/src/game/RoomSpec.js'
import type {
  ButtonSpec,
  InstructionEventSpec,
} from '../../../react-three-capacitor/src/game/GameSpec.js'
import type { RoomConnection } from '../../../react-three-capacitor/src/game/WorldSpec.js'
import {
  computeRoomPositions,
  validateWorldSpec,
} from '../../../react-three-capacitor/src/game/WorldSpec.js'
import { buildMapInstanceArtifacts } from '../../../react-three-capacitor/src/game/MapInstance.js'
import { buildCameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint.js'

const MAP_INSTANCE_ID = 'prod_gates'

// Three stacked rooms (south → north):
//   spawn    0.25 × 0.25  — hub dock below, open north edge into corridor
//   corridor 0.50 × 1.25  — three full-span internal doors (gate1/2/3) split
//                           it into four bands; a button sits in each of the
//                           first three bands, just south of its gate
//   victory  0.25 × 0.25  — safe zone north of the corridor
//
// The corridor's south / north walls are split into a centred 0.25 gap
// (spawn / victory connections) flanked by solid 0.125 pieces. Each gate
// spans the full inner width (CORR_INNER_W) and is toggled off when the
// corresponding button fires (see scenario.ts).
//
// Buttons are `enableClientPress: true`, `requiredPlayers: 1` — a single
// player on the pad triggers a press. The scenario disables each button
// after its first fire so the damage roll can't repeat.

const bt = 0.025
const bh = 0.025
const BY = bh / 2
const ROOM_H = 0.5

// ── spawn ─────────────────────────────────────────────────────────────────
const SPAWN_W = 0.25
const SPAWN_D = 0.25
const SPAWN_HW = SPAWN_W / 2
const SPAWN_HD = SPAWN_D / 2
const SPAWN_WALL_C  = SPAWN_HD - bt / 2
const SPAWN_WALL_CX = SPAWN_HW - bt / 2
const SPAWN_EW_DEPTH = 2 * (SPAWN_HD - bt)

// ── corridor ──────────────────────────────────────────────────────────────
const CORR_W = 0.5
const CORR_D = 1.25
const CORR_HW = CORR_W / 2
const CORR_HD = CORR_D / 2
const CORR_WALL_C  = CORR_HD - bt / 2
const CORR_WALL_CX = CORR_HW - bt / 2
const CORR_EW_DEPTH = 2 * (CORR_HD - bt)
const CORR_INNER_W = CORR_W - 2 * bt  // 0.45

// Door gap matches the spawn / victory room width (0.25), so the flanking
// pieces of the corridor's south / north walls are each (0.5 - 0.25) / 2 = 0.125.
const DOOR_GAP_W = 0.25
const CORR_END_SIDE_W  = (CORR_W - DOOR_GAP_W) / 2      // 0.125
const CORR_END_SIDE_CX = (CORR_W + DOOR_GAP_W) / 4      // 0.1875

// Four equal bands of depth BAND_D = 0.3125. Gates sit on the band
// boundaries; band 1 is the entry band (south), band 4 is the exit band
// (north, leading to the victory connection).
const BAND_D  = CORR_D / 4
const GATE1_Z = CORR_HD - 1 * BAND_D   //  +0.3125
const GATE2_Z = CORR_HD - 2 * BAND_D   //   0
const GATE3_Z = CORR_HD - 3 * BAND_D   //  -0.3125

// Button sits roughly in the middle of its band, a short distance south of
// the gate so a player approaching the gate naturally enters the trigger
// radius before the wall stops them.
const BTN_OFFSET    = 0.08
const BTN1_Z = GATE1_Z + BTN_OFFSET    //  +0.3925
const BTN2_Z = GATE2_Z + BTN_OFFSET    //  +0.08
const BTN3_Z = GATE3_Z + BTN_OFFSET    //  -0.2325

const BTN_TRIGGER_R       = 0.06
const BTN_PLATFORM_R      = 0.045
const BTN_RING_OUTER_R    = 0.0495
const BTN_RING_INNER_R    = 0.045
const BTN_RAISED_H        = 0.012

// ── victory ───────────────────────────────────────────────────────────────
const VICT_W = 0.25
const VICT_D = 0.25
const VICT_HW = VICT_W / 2
const VICT_HD = VICT_D / 2
const VICT_WALL_C  = VICT_HD - bt / 2
const VICT_WALL_CX = VICT_HW - bt / 2
const VICT_EW_DEPTH = 2 * (VICT_HD - bt)

// ──────────────────────────────────────────────────────────────────────────

const ROOMS: RoomSpec[] = [
  {
    id: 'spawn', name: 'Spawn',
    floorWidth: SPAWN_W, floorDepth: SPAWN_D, height: ROOM_H,
    cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
    // South wall is the hub dock (full 0.25 span, matches hallway width).
    // North edge is open — owned by corridor's south wall.
    geometry: [
      { id: 'pg_spawn_s', cx: 0,               cy: BY, cz:  SPAWN_WALL_C, width: SPAWN_W, height: bh, depth: bt },
      { id: 'pg_spawn_e', cx:  SPAWN_WALL_CX,  cy: BY, cz: 0,             width: bt,      height: bh, depth: SPAWN_EW_DEPTH },
      { id: 'pg_spawn_w', cx: -SPAWN_WALL_CX,  cy: BY, cz: 0,             width: bt,      height: bh, depth: SPAWN_EW_DEPTH },
    ],
  },
  {
    id: 'corridor', name: 'Production Gates',
    floorWidth: CORR_W, floorDepth: CORR_D, height: ROOM_H,
    // Camera follows along z; keep it centred on x so the tall room reads vertically.
    cameraRect: { xMin: 0, xMax: 0, zMin: -CORR_HD + 0.25, zMax: CORR_HD - 0.25 },
    // South / north walls are split around a centred 0.25 gap (spawn / victory
    // connections). E/W walls are continuous. Three internal gates (full inner
    // span each) start CLOSED; the scenario drops them one at a time.
    geometry: [
      // South wall (around spawn connection).
      { id: 'pg_corr_sl', cx: -CORR_END_SIDE_CX, cy: BY, cz:  CORR_WALL_C, width: CORR_END_SIDE_W, height: bh, depth: bt },
      { id: 'pg_corr_sr', cx:  CORR_END_SIDE_CX, cy: BY, cz:  CORR_WALL_C, width: CORR_END_SIDE_W, height: bh, depth: bt },
      // North wall (around victory connection).
      { id: 'pg_corr_nl', cx: -CORR_END_SIDE_CX, cy: BY, cz: -CORR_WALL_C, width: CORR_END_SIDE_W, height: bh, depth: bt },
      { id: 'pg_corr_nr', cx:  CORR_END_SIDE_CX, cy: BY, cz: -CORR_WALL_C, width: CORR_END_SIDE_W, height: bh, depth: bt },
      // E/W walls.
      { id: 'pg_corr_e', cx:  CORR_WALL_CX, cy: BY, cz: 0, width: bt, height: bh, depth: CORR_EW_DEPTH },
      { id: 'pg_corr_w', cx: -CORR_WALL_CX, cy: BY, cz: 0, width: bt, height: bh, depth: CORR_EW_DEPTH },
      // Gates — full inner span, single segment each. Distinct color so the
      // doors read as doors rather than outer walls.
      { id: 'gate1', cx: 0, cy: BY, cz: GATE1_Z, width: CORR_INNER_W, height: bh, depth: bt, color: '#8e44ad' },
      { id: 'gate2', cx: 0, cy: BY, cz: GATE2_Z, width: CORR_INNER_W, height: bh, depth: bt, color: '#8e44ad' },
      { id: 'gate3', cx: 0, cy: BY, cz: GATE3_Z, width: CORR_INNER_W, height: bh, depth: bt, color: '#8e44ad' },
    ],
  },
  {
    id: 'victory', name: 'Victory',
    floorWidth: VICT_W, floorDepth: VICT_D, height: ROOM_H,
    cameraRect: { xMin: 0, xMax: 0, zMin: 0, zMax: 0 },
    // South edge is open — owned by corridor's north wall.
    geometry: [
      { id: 'pg_vict_n', cx: 0,              cy: BY, cz: -VICT_WALL_C, width: VICT_W, height: bh, depth: bt },
      { id: 'pg_vict_e', cx:  VICT_WALL_CX,  cy: BY, cz: 0,            width: bt,     height: bh, depth: VICT_EW_DEPTH },
      { id: 'pg_vict_w', cx: -VICT_WALL_CX,  cy: BY, cz: 0,            width: bt,     height: bh, depth: VICT_EW_DEPTH },
    ],
  },
]

const CONNECTIONS: RoomConnection[] = [
  {
    roomIdA: 'spawn',    wallA: 'north', positionA: 0.5,
    roomIdB: 'corridor', wallB: 'south', positionB: 0.5,
    width: DOOR_GAP_W,
  },
  {
    roomIdA: 'corridor', wallA: 'north', positionA: 0.5,
    roomIdB: 'victory',  wallB: 'south', positionB: 0.5,
    width: DOOR_GAP_W,
  },
]

const TOPOLOGY = { rooms: ROOMS, connections: CONNECTIONS }
const LOCAL_POSITIONS = computeRoomPositions(TOPOLOGY)
validateWorldSpec(TOPOLOGY, LOCAL_POSITIONS)
const ARTIFACTS = buildMapInstanceArtifacts(TOPOLOGY, MAP_INSTANCE_ID)
const CAMERA_SHAPES = buildCameraConstraintShapes(TOPOLOGY, LOCAL_POSITIONS)

const BUTTONS: ButtonSpec[] = [
  {
    id: 'btn_open_1',
    x: 0, z: BTN1_Z,
    triggerRadius: BTN_TRIGGER_R,
    platformRadius: BTN_PLATFORM_R,
    ringOuterRadius: BTN_RING_OUTER_R,
    ringInnerRadius: BTN_RING_INNER_R,
    raisedHeight: BTN_RAISED_H,
    color: '#27ae60', ringColor: '#2ecc71',
    requiredPlayers: 1, holdAfterRelease: false, cooldownMs: 0, enableClientPress: true,
  },
  {
    id: 'btn_open_2',
    x: 0, z: BTN2_Z,
    triggerRadius: BTN_TRIGGER_R,
    platformRadius: BTN_PLATFORM_R,
    ringOuterRadius: BTN_RING_OUTER_R,
    ringInnerRadius: BTN_RING_INNER_R,
    raisedHeight: BTN_RAISED_H,
    color: '#27ae60', ringColor: '#2ecc71',
    requiredPlayers: 1, holdAfterRelease: false, cooldownMs: 0, enableClientPress: true,
  },
  {
    id: 'btn_open_3',
    x: 0, z: BTN3_Z,
    triggerRadius: BTN_TRIGGER_R,
    platformRadius: BTN_PLATFORM_R,
    ringOuterRadius: BTN_RING_OUTER_R,
    ringInnerRadius: BTN_RING_INNER_R,
    raisedHeight: BTN_RAISED_H,
    color: '#27ae60', ringColor: '#2ecc71',
    requiredPlayers: 1, holdAfterRelease: false, cooldownMs: 0, enableClientPress: true,
  },
]

const INSTRUCTION_SPECS: InstructionEventSpec[] = [
  { id: 'rule_open',     text: 'Press OPEN to unlock each gate',           label: 'RULE' },
  { id: 'rule_timer',    text: 'Reach the north room in 30 seconds',       label: 'RULE' },
  { id: 'fact_survived', text: 'You reached the victory room',             label: 'FACT' },
]

// ── Metadata used by scenario.ts ──────────────────────────────────────────
//
// Button → gate mapping:
//   btn_open_1 → gate1   (south-most, first obstacle from spawn)
//   btn_open_2 → gate2
//   btn_open_3 → gate3   (north-most, last obstacle before victory)
//
// Scoped room ids (mapInstanceId prefix applied at runtime):
//   prod_gates_spawn, prod_gates_corridor, prod_gates_victory

export const MAP: GameMap = {
  id: 'prod_gates',
  mapInstanceId: MAP_INSTANCE_ID,
  rooms: ROOMS,
  connections: CONNECTIONS,
  roomPositions: ARTIFACTS.roomPositions,
  cameraShapes: CAMERA_SHAPES,
  instructionSpecs: INSTRUCTION_SPECS,
  voteRegions: [],
  buttons: BUTTONS,
  npcs: [],
  getRoomAtPosition: ARTIFACTS.getRoomAtPosition,
  getAdjacentRoomIds: ARTIFACTS.getAdjacentRoomIds,
  isRoomOverlapping: ARTIFACTS.isRoomOverlapping,
}
