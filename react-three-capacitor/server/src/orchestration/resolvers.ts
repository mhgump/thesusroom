import type { ContentRegistry } from '../ContentRegistry.js'
import type { BotSpec } from '../bot/BotTypes.js'
import {
  DefaultScenarioOrchestration,
  type DefaultScenarioOrchestrationOptions,
} from './DefaultScenarioOrchestration.js'
import type { RoutingResolver } from './RoomOrchestration.js'
import { MAP as INITIAL_MAP } from '../../../../assets/initial/map.js'
import { SCENARIO as INITIAL_SCENARIO } from '../../../../assets/initial/scenario.js'

// `r_initial` is the built-in scenario shipped with the frontend assets: its
// map and script are statically imported so the root URL (`/`) always has a
// destination even before any content has been loaded. Scenarios authored
// under `content/` use the `r_{scenario_id}` form and go through the content
// registry. Unknown keys resolve to null; the router rejects those
// connections with close code 4004.
export function createDefaultScenarioResolver(
  content: ContentRegistry,
  spawnBotFn: (routingKey: string, spec: BotSpec) => void,
  options?: DefaultScenarioOrchestrationOptions,
): RoutingResolver {
  return async (routingKey: string) => {
    if (routingKey === 'r_initial') {
      return new DefaultScenarioOrchestration(INITIAL_MAP, INITIAL_SCENARIO, spawnBotFn, options)
    }
    if (!routingKey.startsWith('r_')) return null
    const scenarioId = routingKey.slice(2)
    if (scenarioId.length === 0) return null
    const entry = await content.get(scenarioId)
    if (!entry) return null
    return new DefaultScenarioOrchestration(entry.map, entry.scenario, spawnBotFn, options)
  }
}
