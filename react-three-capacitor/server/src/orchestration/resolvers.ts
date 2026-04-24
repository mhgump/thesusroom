import type { ContentRegistry } from '../ContentRegistry.js'
import type { BotSpec } from '../bot/BotTypes.js'
import { DefaultScenarioOrchestration } from './DefaultScenarioOrchestration.js'
import type { RoutingResolver } from './RoomOrchestration.js'

// A routing key of the form `r_{scenario_id}` resolves to the default
// scenario orchestration, with `{scenario_id}` looked up in the content
// registry. Unknown scenarios resolve to null; the router rejects those
// connections with close code 4004. The lookup is async because content
// is loaded lazily from the data backend on miss.
export function createDefaultScenarioResolver(
  content: ContentRegistry,
  spawnBotFn: (routingKey: string, spec: BotSpec) => void,
  options?: { tickRateHz?: number; autoStartScenario?: boolean },
): RoutingResolver {
  return async (routingKey: string) => {
    if (!routingKey.startsWith('r_')) return null
    const scenarioId = routingKey.slice(2)
    if (scenarioId.length === 0) return null
    const entry = await content.get(scenarioId)
    if (!entry) return null
    return new DefaultScenarioOrchestration(entry.map, entry.scenario, spawnBotFn, options)
  }
}
