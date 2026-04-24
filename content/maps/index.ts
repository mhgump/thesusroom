import type { GameMap } from '../../react-three-capacitor/src/game/GameMap.js'
import { MAP as INITIAL_MAP } from '../../assets/initial/map.js'

export type { GameMap }

// Extracts `{scenario}` from an `r_{scenario}` routing key, or null if the
// key is not in that shape.
function scenarioFromRoutingKey(key: string): string | null {
  if (!key.startsWith('r_')) return null
  const name = key.slice(2)
  return name.length === 0 ? null : name
}

// Parses a routing-key path (`/r_scenario1`) or an observer path
// (`/observe/r_scenario1/0/0`) into the scenario id used to pick the
// client map. Returns null for `/`, `/recordings/:idx`, and anything
// else that does not carry a scenario id — the caller falls back to the
// bundled initial map without fetching a scenario-specific chunk. For
// replay paths the map is rebuilt from the recording's own `world_reset`
// event, so no static import is needed.
function parseScenarioIdFromPath(pathname: string): string | null {
  const path = pathname.replace(/^\/+/, '').replace(/\/+$/, '')
  if (path.length === 0) return null
  const observer = path.match(/^observe\/([^/]+)\/\d+\/\d+$/)
  if (observer) return scenarioFromRoutingKey(observer[1])
  const first = path.split('/')[0]
  return scenarioFromRoutingKey(first)
}

// Derived from the URL path at module load time — stable for the session.
// `null` means "use the bundled initial map" (the `/` root case).
export const CURRENT_SCENARIO_ID: string | null =
  typeof window !== 'undefined'
    ? parseScenarioIdFromPath(window.location.pathname)
    : null

// `import.meta.glob` builds a lazy-loader map keyed by each sibling map
// module path; Vite emits one chunk per entry so only the map for
// CURRENT_SCENARIO_ID is fetched at runtime. Initial loads statically (see
// INITIAL_MAP above) so the `/` root renders without a chunk fetch — visiting
// the site is enough to see the initial map even if WebSocket never connects.
// Cast via `unknown` because `import.meta.glob` is a Vite-runtime extension
// (not part of the TS lib), and the server's tsc sees this file too.
const MAP_LOADERS = (import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<{ MAP: GameMap }>> }).glob('./*/map.ts')

async function loadCurrentMap(): Promise<GameMap> {
  if (CURRENT_SCENARIO_ID === null) return INITIAL_MAP
  const loader = MAP_LOADERS[`./${CURRENT_SCENARIO_ID}/map.ts`]
  if (!loader) return INITIAL_MAP
  const mod = await loader()
  return mod.MAP
}

export const CURRENT_MAP: GameMap = await loadCurrentMap()
