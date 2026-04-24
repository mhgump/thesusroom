import type { ContentRegistry, ScenarioSpec } from '../ContentRegistry.js'
import type { GameMap } from '../../../src/game/GameMap.js'
import type { MultiplayerRoom } from '../Room.js'
import type { ScenarioRunRegistry } from '../scenarioRun/ScenarioRunRegistry.js'
import type { ConnectionHandler } from '../connections/types.js'
import {
  DefaultScenarioOrchestration,
  type DefaultScenarioOrchestrationOptions,
} from './DefaultScenarioOrchestration.js'
import { ScenarioRunOrchestration } from './ScenarioRunOrchestration.js'
import { DefaultGameOrchestration } from './DefaultGameOrchestration.js'
import type { LoopOrchestration } from './LoopOrchestration.js'
import type { RoutingResolver } from './RoomOrchestration.js'
import {
  chooseMostPopulatedOpenRoom,
  createRoundRobinScenarioChooser,
} from './hubDecisions.js'
import { MAP as INITIAL_MAP } from '../../../../assets/initial/map.js'
import { SCENARIO as INITIAL_SCENARIO } from '../../../../assets/initial/scenario.js'
import {
  getDataBackend,
  ScenarioList,
  VettedScenarios,
} from '../../../../tools/src/_shared/backends/index.js'

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
// singleton, which:
//   1. packs arriving `/` players into the most-populated open hub-capable
//      room (`chooseMostPopulatedOpenRoom`);
//   2. falls back to round-robin across every hub-capable scenario
//      (`createRoundRobinScenarioChooser`) when no such room exists.
// Swap the policy by passing a different pair of choosers. Unknown keys
// resolve to null; the dispatcher rejects those connections with 4004.
export function createDefaultScenarioResolver(
  content: ContentRegistry,
  scenarioRunRegistry: ScenarioRunRegistry,
  options: DefaultScenarioOrchestrationOptions | undefined,
  onExitScenario: (sourceRoom: MultiplayerRoom, sourceMap: GameMap, sourceScenario: ScenarioSpec) => void,
  loopOrchestration: LoopOrchestration,
): RoutingResolver {
  // Fold the exit-transfer trigger into the per-scenario orchestration
  // options. Every DefaultScenarioOrchestration instance below inherits it;
  // only scenarios whose spec carries `exitConnection` will actually invoke
  // it (the MR wires the callback out only in that case).
  const scenarioOptions: DefaultScenarioOrchestrationOptions = {
    ...(options ?? {}),
    onExitScenario,
  }
  // Singleton: one instance per server, kept across all `/` connections so
  // the solo-hallway counter and round-robin cursor stay monotonic. The
  // scenario chooser is stateful (closure cursor), so it must be
  // instantiated here — not per-call — for round-robin to actually cycle.
  const defaultGame = new DefaultGameOrchestration({
    resolveHubTargets: () => listHubCapableRoutingKeys(content),
    chooseExistingRoom: chooseMostPopulatedOpenRoom,
    chooseScenario: createRoundRobinScenarioChooser(),
    initialMap: INITIAL_MAP,
    initialHallwaySpawnLocal: INITIAL_HALLWAY_SPAWN_LOCAL,
  })

  return async (routingKey: string): Promise<ConnectionHandler | null> => {
    if (routingKey === 'hub') {
      return defaultGame
    }
    if (routingKey === 'loop') {
      return loopOrchestration
    }
    if (routingKey.startsWith(SCENARIO_RUN_PREFIX)) {
      const run = scenarioRunRegistry.getByRoutingKey(routingKey)
      if (!run) return null
      return new ScenarioRunOrchestration(run, scenarioRunRegistry)
    }
    if (routingKey === 'scenarios/initial') {
      return new DefaultScenarioOrchestration(INITIAL_MAP, INITIAL_SCENARIO, scenarioOptions)
    }
    if (!routingKey.startsWith(SCENARIOS_PREFIX)) return null
    const scenarioId = routingKey.slice(SCENARIOS_PREFIX.length)
    if (scenarioId.length === 0) return null
    const entry = await content.get(scenarioId)
    if (!entry) return null
    return new DefaultScenarioOrchestration(entry.map, entry.scenario, scenarioOptions)
  }
}

// Enumerate every authored scenario and return the routing key of each one
// whose spec declares a `hubConnection`. Result order matches the persisted
// `ScenarioList` order, so round-robin behaviour is deterministic across
// server restarts given the same content set. Scenarios that fail to load
// (returned `undefined` from the content registry) are silently skipped —
// broken content shouldn't block the hub flow.
async function listHubCapableRoutingKeys(content: ContentRegistry): Promise<string[]> {
  const data = getDataBackend()
  const list = new ScenarioList(data, new VettedScenarios(data))
  const scenarioIds = await list.listScenarios()
  const keys: string[] = []
  for (const id of scenarioIds) {
    try {
      const entry = await content.get(id)
      if (entry?.scenario.hubConnection) keys.push(`${SCENARIOS_PREFIX}${id}`)
    } catch (err) {
      // A scenario failing validation (or otherwise failing to load) shouldn't
      // poison the hub for the rest. Surface the error and move on so healthy
      // scenarios stay reachable.
      console.warn(`[resolvers] skipping scenario '${id}' from hub list: ${err instanceof Error ? err.message : err}`)
    }
  }
  return keys
}
