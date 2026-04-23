import type { GameMap } from '../../react-three-capacitor/src/game/GameMap.js'
import { DEMO_MAP } from './demo.js'
import { SCENARIO1_MAP } from './scenario1.js'
import { SCENARIO2_MAP } from './scenario2.js'
import { SCENARIO3_MAP } from './scenario3.js'
import { SCENARIO4_MAP } from './scenario4.js'

export type { GameMap }
export { DEMO_MAP, SCENARIO1_MAP, SCENARIO2_MAP, SCENARIO3_MAP, SCENARIO4_MAP }

const ALL_MAPS: Record<string, GameMap> = {
  demo:      DEMO_MAP,
  scenario1: SCENARIO1_MAP,
  scenario2: SCENARIO2_MAP,
  scenario3: SCENARIO3_MAP,
  scenario4: SCENARIO4_MAP,
}

// Derived from the URL path at module load time — stable for the session.
export const CURRENT_SCENARIO_ID: string =
  typeof window !== 'undefined'
    ? window.location.pathname.replace(/^\/+/, '') || 'demo'
    : 'demo'

export const CURRENT_MAP: GameMap = ALL_MAPS[CURRENT_SCENARIO_ID] ?? DEMO_MAP
