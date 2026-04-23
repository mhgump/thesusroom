import type { MapSpec } from '../../../react-three-capacitor/server/src/ScenarioRegistry.js'

const R = 0.0282

const CTR_W  = 0.75
const CTR_D  = 0.75
const HALL_W = 0.25
const HALL_D = 0.75

const HALL_CZ = CTR_D / 2 + HALL_D / 2  // 0.75

function s4GetRoomAtPosition(x: number, z: number): string | null {
  const rooms = [
    { id: 'center',     cx: 0, cz: 0,        hw: CTR_W  / 2, hd: CTR_D  / 2 },
    { id: 'north_hall', cx: 0, cz: -HALL_CZ, hw: HALL_W / 2, hd: HALL_D / 2 },
    { id: 'south_hall', cx: 0, cz: +HALL_CZ, hw: HALL_W / 2, hd: HALL_D / 2 },
  ]
  for (const r of rooms) {
    if (Math.abs(x - r.cx) <= r.hw && Math.abs(z - r.cz) <= r.hd) return r.id
  }
  return null
}

export const SCENARIO4_MAP: MapSpec = {
  id: 'scenario4',
  walkable: {
    rects: [
      { cx: 0, cz: 0,        hw: 0.3468, hd: 0.3468 },
      { cx: 0, cz: -HALL_CZ, hw: 0.0968, hd: 0.3468 },
      { cx: 0, cz: +HALL_CZ, hw: 0.0968, hd: 0.3468 },
      // thin connector at north doorway
      { cx: 0, cz: -(CTR_D / 2), hw: 0.0968, hd: 0.0282 },
      // thin connector at south doorway
      { cx: 0, cz: +(CTR_D / 2), hw: 0.0968, hd: 0.0282 },
    ],
  },
  npcs: [],
  voteRegions: [],
  geometry: [],
  getRoomAtPosition: s4GetRoomAtPosition,
}
