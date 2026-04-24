import type { ContentRegistry } from '../ContentRegistry.js'
import type { BotSpec } from '../bot/BotTypes.js'
import type { ScenarioRunRegistry } from '../scenarioRun/ScenarioRunRegistry.js'
import type { ConnectionHandler } from '../connections/types.js'
import {
  DefaultScenarioOrchestration,
  type DefaultScenarioOrchestrationOptions,
} from './DefaultScenarioOrchestration.js'
import { ScenarioRunOrchestration } from './ScenarioRunOrchestration.js'
import { DefaultGameOrchestration } from './DefaultGameOrchestration.js'
import type { RoutingResolver } from './RoomOrchestration.js'
import { MAP as INITIAL_MAP } from '../../../../assets/initial/map.js'
import { SCENARIO as INITIAL_SCENARIO } from '../../../../assets/initial/scenario.js'

// Hardcoded first-pass hub target: `/` visitors are routed into scenario2
// via the solo-hallway transfer flow. A future iteration will round-robin
// across any scenario whose spec declares a `hubConnection`.
const HUB_TARGET_ROUTING_KEY = 'scenarios/scenario2'

// Initial hallway's authored spawn — the solo MR seeds the player here and
// the hub transfer translates it into the target MR's world frame.
const INITIAL_HALLWAY_SPAWN_LOCAL = { x: 0, z: 0.5 }

const SCENARIOS_PREFIX = 'scenarios/'
const SCENARIO_RUN_PREFIX = 'scenariorun/'

// `scenarios/initial` is the built-in scenario shipped with the frontend
// assets: its map and script are statically imported so `/scenarios/initial`
// always resolves even before any content has been loaded. Scenarios authored
// under `content/` use the `scenarios/{scenario_id}` form and go through the
// content registry. `scenariorun/{runId}` keys are one-shot scenario-run
// harness rooms looked up in the ScenarioRunRegistry. The `hub` routing key
// (empty URL path) is handled by the shared `DefaultGameOrchestration`
// singleton. Unknown keys resolve to null; the dispatcher rejects those
// connections with 4004.
export function createDefaultScenarioResolver(
  content: ContentRegistry,
  spawnBotFn: (routingKey: string, spec: BotSpec) => void,
  scenarioRunRegistry: ScenarioRunRegistry,
  options?: DefaultScenarioOrchestrationOptions,
): RoutingResolver {
  // Singleton: one instance per server, kept across all `/` connections so
  // the solo-hallway counter stays monotonic across connects.
  const defaultGame = new DefaultGameOrchestration({
    targetRoutingKey: HUB_TARGET_ROUTING_KEY,
    initialMap: INITIAL_MAP,
    initialHallwaySpawnLocal: INITIAL_HALLWAY_SPAWN_LOCAL,
  })

  return async (routingKey: string): Promise<ConnectionHandler | null> => {
    if (routingKey === 'hub') {
      return defaultGame
    }
    if (routingKey.startsWith(SCENARIO_RUN_PREFIX)) {
      const run = scenarioRunRegistry.getByRoutingKey(routingKey)
      if (!run) return null
      return new ScenarioRunOrchestration(run, scenarioRunRegistry, spawnBotFn)
    }
    if (routingKey === 'scenarios/initial') {
      return new DefaultScenarioOrchestration(INITIAL_MAP, INITIAL_SCENARIO, spawnBotFn, options)
    }
    if (!routingKey.startsWith(SCENARIOS_PREFIX)) return null
    const scenarioId = routingKey.slice(SCENARIOS_PREFIX.length)
    if (scenarioId.length === 0) return null
    const entry = await content.get(scenarioId)
    if (!entry) return null
    return new DefaultScenarioOrchestration(entry.map, entry.scenario, spawnBotFn, options)
  }
}
