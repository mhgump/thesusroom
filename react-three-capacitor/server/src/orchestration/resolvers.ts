import type { ContentRegistry } from '../ContentRegistry.js'
import type { BotSpec } from '../bot/BotTypes.js'
import {
  DefaultScenarioOrchestration,
  type DefaultScenarioOrchestrationOptions,
} from './DefaultScenarioOrchestration.js'
import { HubOrchestration } from './HubOrchestration.js'
import type { RoutingResolver } from './RoomOrchestration.js'
import { MAP as INITIAL_MAP } from '../../../../assets/initial/map.js'
import { SCENARIO as INITIAL_SCENARIO } from '../../../../assets/initial/scenario.js'

// The default hub target — the scenario players walk into from `/`. First
// pass hardcodes this to scenario2; a later pass will pick from a set of
// open rooms or create on demand.
const HUB_DEFAULT_SCENARIO_ID = 'scenario2'

// `r_initial` is the built-in scenario shipped with the frontend assets: its
// map and script are statically imported so `/r_initial` always resolves
// even before any content has been loaded. Scenarios authored under
// `content/` use the `r_{scenario_id}` form and go through the content
// registry. The empty path resolves to `hub` — the combined hub world that
// places initial's hallway adjacent to the hub's default target scenario.
// Unknown keys resolve to null; the router rejects those connections with
// close code 4004.
export function createDefaultScenarioResolver(
  content: ContentRegistry,
  spawnBotFn: (routingKey: string, spec: BotSpec) => void,
  options?: DefaultScenarioOrchestrationOptions,
): RoutingResolver {
  return async (routingKey: string) => {
    if (routingKey === 'hub') {
      const entry = await content.get(HUB_DEFAULT_SCENARIO_ID)
      if (!entry) return null
      return new HubOrchestration(entry.scenario, entry.map, spawnBotFn)
    }
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
