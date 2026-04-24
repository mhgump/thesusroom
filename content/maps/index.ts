import type { GameMap } from '../../react-three-capacitor/src/game/GameMap.js'
import { MAP as INITIAL_MAP } from '../../assets/initial/map.js'

export type { GameMap }

// Parses a scenario path (`/scenarios/{id}`) or an observer path
// (`/observe/scenarios/{id}/0/0`) into the scenario id used to pick the
// client map. Returns null for `/`, `/scenariorun/:id`, `/recordings/:idx`,
// and anything else that does not carry a scenario id — the caller falls
// back to the bundled initial map without fetching a scenario-specific
// chunk. For replay paths the map is rebuilt from the recording's own
// `world_reset` event, so no static import is needed.
function parseScenarioIdFromPath(pathname: string): string | null {
  const path = pathname.replace(/^\/+/, '').replace(/\/+$/, '')
  if (path.length === 0) return null
  const observer = path.match(/^observe\/scenarios\/([^/]+)\/\d+\/\d+$/)
  if (observer) return observer[1]
  const scenario = path.match(/^scenarios\/([^/]+)$/)
  if (scenario) return scenario[1]
  return null
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
