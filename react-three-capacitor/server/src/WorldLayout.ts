// Pre-computed walkable area for the default 3-room world.
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

// Room centers (Room 1 at origin, others derived from connections)
const R2Z = -(R1H / 2 + R2H / 2)
const R3Z = R2Z - (R2H / 2 + R3H / 2)

const DOOR_HW = R2W / 2 - R   // half door width inset
const EDGE1 = -(R1H / 2)       // shared edge: Room 1 north / Room 2 south
const EDGE2 = R2Z - R2H / 2    // shared edge: Room 2 north / Room 3 south

// Room centre world-space coordinates — used by NPC spawn positions.
export const ROOM1_CENTER_X = 0
export const ROOM1_CENTER_Z = 0
export const ROOM2_CENTER_X = 0
export const ROOM2_CENTER_Z = R2Z
export const ROOM3_CENTER_X = 0
export const ROOM3_CENTER_Z = R3Z

export const DEFAULT_WALKABLE: WalkableArea = {
  rects: [
    { cx: 0, cz: 0,   hw: R1W / 2 - R, hd: R1H / 2 - R },
    { cx: 0, cz: R2Z, hw: R2W / 2 - R, hd: R2H / 2 - R },
    { cx: 0, cz: R3Z, hw: R3W / 2 - R, hd: R3H / 2 - R },
    { cx: 0, cz: EDGE1, hw: DOOR_HW, hd: R },  // corridor 1↔2
    { cx: 0, cz: EDGE2, hw: DOOR_HW, hd: R },  // corridor 2↔3
  ],
}
