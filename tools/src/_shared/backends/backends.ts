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
  // Ingest any sibling binary artifacts (video, screenshot) the run's child
  // process wrote to its staging dir. Filesystem backends: no-op, since
  // locate() returns the canonical storage dir and the child wrote directly
  // there. Postgres backends: gzip-compress each file and upsert it under the
  // run key. Called by the runScenario tool after `put()`.
  putBlobs(key: RunResultKey, dir: string): Promise<void>
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

// Composite of the per-content-type key/value backends. Each sub-backend is a
// pre-existing abstraction over one content type's on-disk layout; they are
// kept bundled here so callers can reach any of them through a single
// accessor. Indexed-metadata operations (scenario list, vetted list, test-spec
// list, agent-conversation log) live on the domain classes in ./ops/, which
// consume the DataBackend primitive rather than this composite.
export interface Backends {
  bot: KeyValueBackend<BotKey, TsSource>
  map: MapBackend
  scenario: ScenarioBackend
  testSpec: TestSpecBackend
  scenarioRunResult: ScenarioRunBackend
}
