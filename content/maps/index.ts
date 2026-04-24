import type { GameMap } from '../../react-three-capacitor/src/game/GameMap.js'

export type { GameMap }

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

// `import.meta.glob` builds a lazy-loader map keyed by each sibling map
// module path; Vite emits one chunk per entry so only the map for
// CURRENT_SCENARIO_ID is fetched at runtime. Falls back to the demo map when
// the URL-derived id doesn't match a known directory.
const MAP_LOADERS = import.meta.glob('./*/map.ts') as Record<string, () => Promise<{ MAP: GameMap }>>

async function loadCurrentMap(): Promise<GameMap> {
  const loader = MAP_LOADERS[`./${CURRENT_SCENARIO_ID}/map.ts`] ?? MAP_LOADERS['./demo/map.ts']
  const mod = await loader()
  return mod.MAP
}

export const CURRENT_MAP: GameMap = await loadCurrentMap()
