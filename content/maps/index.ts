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

// Extracts `{scenario}` from an `r_{scenario}` routing key, or null if the
// key is not in that shape.
function scenarioFromRoutingKey(key: string): string | null {
  if (!key.startsWith('r_')) return null
  const name = key.slice(2)
  return name.length === 0 ? null : name
}

// Parses either a direct routing-key path (`/r_demo`) or an observer path
// (`/observe/r_demo/0/0`) into the scenario id used to pick the client map.
// Defaults to `demo` when the URL yields nothing useable — this also means
// `/` still loads the demo scenario during local development.
function parseScenarioIdFromPath(pathname: string): string {
  const path = pathname.replace(/^\/+/, '').replace(/\/+$/, '')
  if (path.length === 0) return 'demo'
  const observer = path.match(/^observe\/([^/]+)\/\d+\/\d+$/)
  if (observer) {
    const scenario = scenarioFromRoutingKey(observer[1])
    return scenario ?? 'demo'
  }
  const first = path.split('/')[0]
  const scenario = scenarioFromRoutingKey(first)
  return scenario ?? 'demo'
}

// Derived from the URL path at module load time — stable for the session.
export const CURRENT_SCENARIO_ID: string =
  typeof window !== 'undefined'
    ? parseScenarioIdFromPath(window.location.pathname)
    : 'demo'

export const CURRENT_MAP: GameMap = ALL_MAPS[CURRENT_SCENARIO_ID] ?? DEMO_MAP
