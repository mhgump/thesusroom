// Side-effect import registers the NPC type before the spec references it.
import '../../../react-three-capacitor/server/src/npc/entities/StillDamager.js'

import type { MapSpec } from '../../../react-three-capacitor/server/src/ScenarioRegistry.js'
import type { WalkableArea } from '../../../react-three-capacitor/server/src/World.js'

// ── Geometry constants (must stay in sync with content/client/maps/demo.ts) ──

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
const R_SH_W = VIEWPORT_W * 0.25
const R_SH_H = VIEWPORT_H
const R_SR_W = VIEWPORT_W
const R_SR_H = VIEWPORT_H

const R2Z = -(R1H / 2 + R2H / 2)
const R3Z = R2Z - (R2H / 2 + R3H / 2)
const R_SH_Z = R1H / 2 + R_SH_H / 2
const R_SR_Z = R_SH_Z + R_SH_H / 2 + R_SR_H / 2

const DOOR_HW = R2W / 2 - R
const EDGE1 = -(R1H / 2)
const EDGE2 = R2Z - R2H / 2
const EDGE3 = R1H / 2
const EDGE4 = R_SH_Z + R_SH_H / 2

const ROOM3_CENTER_X = 0
const ROOM3_CENTER_Z = R3Z
const SOUTH_ROOM_CENTER_X = 0
const SOUTH_ROOM_CENTER_Z = R_SR_Z

const WALKABLE: WalkableArea = {
  rects: [
    { cx: 0, cz: 0,      hw: R1W / 2 - R,    hd: R1H / 2 - R },
    { cx: 0, cz: R2Z,    hw: R2W / 2 - R,    hd: R2H / 2 - R },
    { cx: 0, cz: R3Z,    hw: R3W / 2 - R,    hd: R3H / 2 - R },
    { cx: 0, cz: R_SH_Z, hw: R_SH_W / 2 - R, hd: R_SH_H / 2 - R },
    { cx: 0, cz: R_SR_Z, hw: R_SR_W / 2 - R, hd: R_SR_H / 2 - R },
    { cx: 0, cz: EDGE1,  hw: DOOR_HW, hd: R },
    { cx: 0, cz: EDGE2,  hw: DOOR_HW, hd: R },
    { cx: 0, cz: EDGE3,  hw: DOOR_HW, hd: R },
    { cx: 0, cz: EDGE4,  hw: DOOR_HW, hd: R },
  ],
}

export const DEMO_MAP: MapSpec = {
  id: 'demo',
  walkable: WALKABLE,
  npcs: [
    {
      id: 'room3-sentinel',
      type: 'still-damager',
      spawnX: ROOM3_CENTER_X,
      spawnZ: ROOM3_CENTER_Z,
      trigger: 'each-action',
      allowedActions: ['dealDamage'],
      allowedHelpers: ['getPosition', 'getPlayersInRange'],
      ux: { has_health: false },
    },
  ],
  voteRegions: [
    { id: 'vote_yes', label: 'Yes', color: '#2ecc71', x: SOUTH_ROOM_CENTER_X - 5, z: SOUTH_ROOM_CENTER_Z, radius: 3 },
    { id: 'vote_no',  label: 'No',  color: '#e74c3c', x: SOUTH_ROOM_CENTER_X + 5, z: SOUTH_ROOM_CENTER_Z, radius: 3 },
  ],
}
