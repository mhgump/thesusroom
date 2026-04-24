import type { GameMap } from '../../../react-three-capacitor/src/game/GameMap.js'
import type { RoomSpec } from '../../../react-three-capacitor/src/game/RoomSpec.js'
import {
  computeRoomPositions,
  validateWorldSpec,
} from '../../../react-three-capacitor/src/game/WorldSpec.js'
import { buildMapInstanceArtifacts } from '../../../react-three-capacitor/src/game/MapInstance.js'
import { buildCameraConstraintShapes } from '../../../react-three-capacitor/src/game/CameraConstraint.js'

const MAP_INSTANCE_ID = 'prod_gates'

// One tall, narrow room. Three internal horizontal walls split the play area
// into four bands plus a small victory room at the top:
//
//   z = -ROOM_D/2  ┌─────────┐  (north wall)
//                  │ victory │
//   z = VICT_Z     ├──┐   ┌──┤  victory threshold wall
//                  │  band4  │
//   z = G3_Z       ├──┐   ┌──┤  gate3 wall
//                  │  band3  │
//   z = G2_Z       ├──┐   ┌──┤  gate2 wall
//                  │  band2  │
//   z = G1_Z       ├──┐   ┌──┤  gate1 wall
//                  │  band1  │  ← spawn here (south, bottom)
//   z = +ROOM_D/2  └─────────┘  (south wall)
//
// Each internal wall is two segments (left + right) flanking a centered gap
// of width DOOR_GAP_W. The "gate" is the central column at x = 0.
//
// Bands are detected by the scenario via player z-coordinate (see metadata
// comment near the bottom). Gate proximity is distance to (0, gateZ).

const ROOM_W = 0.5
const ROOM_D = 1.2
const ROOM_H = 0.5

const bt = 0.025
const bh = 0.025
const BY = bh / 2

const HW = ROOM_W / 2
const HD = ROOM_D / 2
const WALL_CX = HW - bt / 2
const WALL_CZ = HD - bt / 2
const EW_DEPTH = 2 * (HD - bt)

// Gap (door) width in each internal wall — centered at x = 0.
const DOOR_GAP_W = 0.1
// Each side segment of an internal wall — extends from the inner face of the
// E/W wall to the gap edge (so it does NOT overlap the E/W walls).
//   inner span = ROOM_W - 2*bt
//   side span  = (inner_span - DOOR_GAP_W) / 2
const SIDE_W  = (ROOM_W - 2 * bt - DOOR_GAP_W) / 2
// Centre x of each side segment: midpoint between the inner face of the E/W
// wall (|x| = HW - bt) and the gap edge (|x| = DOOR_GAP_W/2).
const SIDE_CX = ((HW - bt) + (DOOR_GAP_W / 2)) / 2

// Z-positions (north is negative z, south is positive z). Divide depth into
// 4 equal bands of depth BAND_D, then a victory area on top.
const VICTORY_D = 0.2
const BANDS_TOTAL_D = ROOM_D - VICTORY_D    // 1.0 across 4 bands
const BAND_D = BANDS_TOTAL_D / 4            // 0.25

// Internal wall z-positions (from south to north):
const G1_Z = HD - 1 * BAND_D                // +0.35  (between band1 / band2)
const G2_Z = HD - 2 * BAND_D                // +0.10  (between band2 / band3)
const G3_Z = HD - 3 * BAND_D                // -0.15  (between band3 / band4)
const VICT_Z = HD - 4 * BAND_D              // -0.40  (between band4 / victory)

// Helper: build the two flanking segments of an internal horizontal wall
// at a given z, with given id prefix.
function internalWall(idPrefix: string, cz: number) {
  return [
    { id: `${idPrefix}_l`, cx: -SIDE_CX, cy: BY, cz, width: SIDE_W, height: bh, depth: bt },
    { id: `${idPrefix}_r`, cx:  SIDE_CX, cy: BY, cz, width: SIDE_W, height: bh, depth: bt },
  ]
}

const ROOMS: RoomSpec[] = [
  {
    id: 'corridor',
    name: 'Production Gates',
    floorWidth: ROOM_W,
    floorDepth: ROOM_D,
    height: ROOM_H,
    cameraRect: { xMin: 0, xMax: 0, zMin: -HD + 0.25, zMax: HD - 0.25 },
    geometry: [
      // Outer walls.
      { id: 'pg_wn', cx: 0,         cy: BY, cz: -WALL_CZ, width: ROOM_W, height: bh, depth: bt },
      { id: 'pg_ws', cx: 0,         cy: BY, cz:  WALL_CZ, width: ROOM_W, height: bh, depth: bt },
      { id: 'pg_we', cx:  WALL_CX,  cy: BY, cz: 0,        width: bt,     height: bh, depth: EW_DEPTH },
      { id: 'pg_ww', cx: -WALL_CX,  cy: BY, cz: 0,        width: bt,     height: bh, depth: EW_DEPTH },

      // Internal horizontal walls (each split into left/right segments
      // flanking a centered gap = the gate).
      ...internalWall('gate1_wall', G1_Z),
      ...internalWall('gate2_wall', G2_Z),
      ...internalWall('gate3_wall', G3_Z),
      ...internalWall('victory_wall', VICT_Z),
    ],
  },
]

const TOPOLOGY = { rooms: ROOMS, connections: [] }
const LOCAL_POSITIONS = computeRoomPositions(TOPOLOGY)
validateWorldSpec(TOPOLOGY, LOCAL_POSITIONS)
const ARTIFACTS = buildMapInstanceArtifacts(TOPOLOGY, MAP_INSTANCE_ID)
const CAMERA_SHAPES = buildCameraConstraintShapes(TOPOLOGY, LOCAL_POSITIONS)

// --- Scenario-introspection metadata --------------------------------------
//
// The scenario can compute which "band" a player is in from their z-coord
// inside the `corridor` room using these boundaries (south → north):
//
//   band1 : z ∈ ( G1_Z , +HD )      (spawn band, bottom of screen)
//   band2 : z ∈ ( G2_Z , G1_Z )
//   band3 : z ∈ ( G3_Z , G2_Z )
//   band4 : z ∈ ( VICT_Z , G3_Z )
//   victory_room : z ∈ ( -HD , VICT_Z )
//
// Gate centres (proximity targets) — all at x = 0:
//   gate1 : (0, G1_Z)   = (0, +0.35)
//   gate2 : (0, G2_Z)   = (0, +0.10)
//   gate3 : (0, G3_Z)   = (0, -0.15)
//
// Wall segment ids (toggleable by the scenario if desired):
//   gate1_wall_l, gate1_wall_r
//   gate2_wall_l, gate2_wall_r
//   gate3_wall_l, gate3_wall_r
//   victory_wall_l, victory_wall_r
//
// Suggested spawn point in band1 (far end from victory):
//   x = 0, z = HD - BAND_D / 2   (i.e. centre of band1, ≈ +0.475)

export const MAP: GameMap = {
  id: 'prod_gates',
  mapInstanceId: MAP_INSTANCE_ID,
  rooms: ROOMS,
  connections: [],
  roomPositions: ARTIFACTS.roomPositions,
  cameraShapes: CAMERA_SHAPES,
  instructionSpecs: [],
  voteRegions: [],
  npcs: [],
  getRoomAtPosition: ARTIFACTS.getRoomAtPosition,
  getAdjacentRoomIds: ARTIFACTS.getAdjacentRoomIds,
  isRoomOverlapping: ARTIFACTS.isRoomOverlapping,
}
