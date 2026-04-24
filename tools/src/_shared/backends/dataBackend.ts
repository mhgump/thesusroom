import type { RunScenarioSpec } from '../runScenarioSpec.js'
import type { KeyValueBackend } from './keyValueBackend.js'
import type {
  BotKey,
  MapKey,
  RunResultKey,
  ScenarioKey,
  ScenarioRunResult,
  TestSpecKey,
  TsSource,
} from './types.js'
// Type-only imports of the runtime shapes scenarios and maps evaluate to. These
// live in the server / client source trees respectively; resolving them here
// does not pull the server or client runtime into this package.
import type { ScenarioSpec } from '../../../../react-three-capacitor/server/src/ContentRegistry.js'
import type { GameMap } from '../../../../react-three-capacitor/src/game/GameMap.js'

// Scenario runs need an atomic "next index" per (scenario, test_spec) to
// assign fresh keys before put().
export interface ScenarioRunBackend extends KeyValueBackend<RunResultKey, ScenarioRunResult> {
  nextIndex(scenario: string, test_spec: string): Promise<number>
}

// load() evaluates the scenario module and returns its `SCENARIO` export. Used
// by the runtime (GameServer, run-scenario) to avoid static imports of content.
export interface ScenarioBackend extends KeyValueBackend<ScenarioKey, TsSource> {
  listIndex(): Promise<string[]>
  load(key: ScenarioKey): Promise<ScenarioSpec | null>
}

export interface MapBackend extends KeyValueBackend<MapKey, TsSource> {
  load(key: MapKey): Promise<GameMap | null>
}

export interface TestSpecBackend extends KeyValueBackend<TestSpecKey, RunScenarioSpec> {
  listIndex(scenario_id: string): Promise<string[]>
}

export interface AgentConversationTurn {
  in_tokens: number
  out_tokens: number
  cost: number
}

export interface AgentConversation {
  id: string
  turns: AgentConversationTurn[]
  total_tokens: number
  total_in_tokens: number
  total_out_tokens: number
  total_cost: number
}

// Unified facade over every piece of data the system maintains. Sub-backends
// remain accessible for low-level key/value access; the facade methods below
// own the indexed metadata: the scenario list, the vetted-scenario subset,
// per-scenario test-spec lists, and the agent-conversation cost log.
export interface DataBackend {
  bot: KeyValueBackend<BotKey, TsSource>
  map: MapBackend
  scenario: ScenarioBackend
  testSpec: TestSpecBackend
  scenarioRunResult: ScenarioRunBackend

  // Scenario list (content/scenario_map.json). addScenario appends and returns
  // the assigned index; deleteScenario removes from the map, cascades to
  // content/bots/{scenario}/ and content/scenario_runs/{scenario}/, and
  // removes the scenario from the vetted list if it's there.
  addScenario(scenario_id: string): Promise<number>
  deleteScenario(scenario_id: string): Promise<void>

  // Vetted-scenario subset (content/vetted_scenarios.json). Both operations
  // are idempotent.
  markScenarioVetted(scenario_id: string): Promise<void>
  markScenarioUnvetted(scenario_id: string): Promise<void>

  // Per-scenario test-spec list (content/scenarios/{scenario}/test_specs.json).
  // addTestSpec appends and returns the assigned index; deleteTestSpec
  // cascades to content/scenario_runs/{scenario}/{test_spec}/.
  addTestSpec(scenario_id: string, test_spec_id: string): Promise<number>
  deleteTestSpec(scenario_id: string, test_spec_id: string): Promise<void>

  // Agent-conversation cost log (content/agent_conversations.json). Appends a
  // turn to the named conversation (creating it if needed) and updates the
  // running totals.
  addAgentConversationCost(
    conversation_id: string,
    turn: AgentConversationTurn,
  ): Promise<void>
}
