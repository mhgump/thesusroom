import type { RunScenarioSpec } from '../runScenarioSpec.js'
import type { DataBackend } from './dataBackend.js'
import { createFilesystemBackends } from './filesystem/index.js'
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
// assign fresh keys before put(). Every backend must provide this — it's
// storage semantics, not a caller concern.
export interface ScenarioRunBackend extends DataBackend<RunResultKey, ScenarioRunResult> {
  nextIndex(scenario: string, test_spec: string): Promise<number>
}

// The scenario backend owns content/scenario_map.json — a JSON array whose
// index is the scenario's position. newScenario appends and returns the
// assigned index; deleteScenario shifts remaining entries so indices stay
// contiguous (the index is a view of the file, not a stable reference).
// Deletes cascade to content/bots/{scenario}/ and content/scenario_runs/{scenario}/.
//
// load() evaluates the scenario module and returns its `SCENARIO` export. Used
// by the runtime (GameServer, run-scenario) to avoid static imports of content.
export interface ScenarioBackend extends DataBackend<ScenarioKey, TsSource> {
  newScenario(scenario_id: string): Promise<number>
  deleteScenario(scenario_id: string): Promise<void>
  listIndex(): Promise<string[]>
  load(key: ScenarioKey): Promise<ScenarioSpec | null>
}

// Mirrors the scenario backend for maps: storage (TsSource) via the base
// interface, plus load() to return the evaluated `MAP` export.
export interface MapBackend extends DataBackend<MapKey, TsSource> {
  load(key: MapKey): Promise<GameMap | null>
}

// The test-spec backend owns content/scenarios/{scenario}/test_specs.json
// per scenario. newTestSpec / deleteTestSpec mirror the scenario backend's
// append / shift semantics at the per-scenario level. Deletes cascade to
// content/scenario_runs/{scenario}/{test_spec}/.
export interface TestSpecBackend extends DataBackend<TestSpecKey, RunScenarioSpec> {
  newTestSpec(scenario_id: string, test_spec_id: string): Promise<number>
  deleteTestSpec(scenario_id: string, test_spec_id: string): Promise<void>
  listIndex(scenario_id: string): Promise<string[]>
}

export interface Backends {
  bot: DataBackend<BotKey, TsSource>
  map: MapBackend
  scenario: ScenarioBackend
  testSpec: TestSpecBackend
  scenarioRunResult: ScenarioRunBackend
}

let cached: Backends | null = null

export function getBackends(): Backends {
  if (cached) return cached
  const kind = process.env.DATA_BACKEND ?? 'filesystem'
  switch (kind) {
    case 'filesystem': {
      cached = createFilesystemBackends()
      return cached
    }
    case 'postgres':
      throw new Error('DATA_BACKEND=postgres not implemented')
    default:
      throw new Error(`unknown DATA_BACKEND: ${kind}`)
  }
}

export * from './types.js'
export * from './dataBackend.js'
