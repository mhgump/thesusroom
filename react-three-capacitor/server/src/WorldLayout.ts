// Pre-computed walkable area for the default 5-room world.
// Must stay in sync with src/game/DefaultWorld.ts and src/game/WorldSpec.ts.
import type { WalkableArea } from './World.js'

const R = 0.35  // CAPSULE_RADIUS — must match World.ts

const VIEWPORT_W = 20
const CAMERA_ANGLE = 25 * (Math.PI / 180)
const VIEWPORT_H = (VIEWPORT_W / (16 / 9)) / Math.cos(CAMERA_ANGLE)

const R1W = VIEWPORT_W * 0.75
const R1H = VIEWPORT_H * 0.75
const R2W = VIEWPORT_W * 0.25
const R2H = VIEWPORT_H
const R3W = VIEWPORT_W * 2.0
const R3H = VIEWPORT_H * 2.0
const R_SH_W = VIEWPORT_W * 0.25  // south hall width (identical to room 2)
const R_SH_H = VIEWPORT_H          // south hall depth (identical to room 2)
const R_SR_W = VIEWPORT_W          // south room width
const R_SR_H = VIEWPORT_H          // south room depth

// Room centers (Room 1 at origin, others derived from connections)
const R2Z = -(R1H / 2 + R2H / 2)
const R3Z = R2Z - (R2H / 2 + R3H / 2)
const R_SH_Z = R1H / 2 + R_SH_H / 2   // south hall: mirror of R2Z
const R_SR_Z = R_SH_Z + R_SH_H / 2 + R_SR_H / 2

const DOOR_HW = R2W / 2 - R   // half door width inset (same for all doorways)
const EDGE1 = -(R1H / 2)       // shared edge: Room 1 north / Room 2 south
const EDGE2 = R2Z - R2H / 2    // shared edge: Room 2 north / Room 3 south
const EDGE3 = R1H / 2           // shared edge: Room 1 south / South Hall north
const EDGE4 = R_SH_Z + R_SH_H / 2  // shared edge: South Hall south / South Room north

// Room centre world-space coordinates — used by NPC spawn positions.
export const ROOM1_CENTER_X = 0
export const ROOM1_CENTER_Z = 0
export const ROOM2_CENTER_X = 0
export const ROOM2_CENTER_Z = R2Z
export const ROOM3_CENTER_X = 0
export const ROOM3_CENTER_Z = R3Z
export const SOUTH_HALL_CENTER_X = 0
export const SOUTH_HALL_CENTER_Z = R_SH_Z
export const SOUTH_ROOM_CENTER_X = 0
export const SOUTH_ROOM_CENTER_Z = R_SR_Z

export const DEFAULT_WALKABLE: WalkableArea = {
  rects: [
    { cx: 0, cz: 0,      hw: R1W / 2 - R,   hd: R1H / 2 - R },
    { cx: 0, cz: R2Z,    hw: R2W / 2 - R,   hd: R2H / 2 - R },
    { cx: 0, cz: R3Z,    hw: R3W / 2 - R,   hd: R3H / 2 - R },
    { cx: 0, cz: R_SH_Z, hw: R_SH_W / 2 - R, hd: R_SH_H / 2 - R },
    { cx: 0, cz: R_SR_Z, hw: R_SR_W / 2 - R, hd: R_SR_H / 2 - R },
    { cx: 0, cz: EDGE1,  hw: DOOR_HW, hd: R },  // corridor 1↔2
    { cx: 0, cz: EDGE2,  hw: DOOR_HW, hd: R },  // corridor 2↔3
    { cx: 0, cz: EDGE3,  hw: DOOR_HW, hd: R },  // corridor 1↔south_hall
    { cx: 0, cz: EDGE4,  hw: DOOR_HW, hd: R },  // corridor south_hall↔south_room
  ],
}
