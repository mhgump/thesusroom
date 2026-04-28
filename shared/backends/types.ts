// Canonical shape lives in tools/src/runScenario/spec.ts — the writer tool
// owns the contract. Re-exported here so backend callers have one import.
export type { ScenarioRunResult } from '../../tools/src/runScenario/spec.js'

export type BotKey = { scenario_id: string; bot_id: string }
export type MapKey = string // map_id
export type ScenarioKey = string // scenario_id
export type TestSpecKey = { scenario_id: string; test_spec_id: string }
// Scenario runs are keyed by (scenario, test_spec, index). test_spec is '_adhoc'
// when the run was not driven by a named test spec. index is 0-based and
// monotonically assigned per (scenario, test_spec) group.
export const ADHOC_TEST_SPEC = '_adhoc'
export type RunResultKey = { scenario: string; test_spec: string; index: number }

// Canonical string form "<scenario>/<test_spec>/<index>". Used as run_id on
// disk and as run_artifact_id in tool inputs.
export function formatRunResultKey(k: RunResultKey): string {
  return `${k.scenario}/${k.test_spec}/${k.index}`
}

export function parseRunResultKey(id: string): RunResultKey | null {
  const parts = id.split('/')
  if (parts.length !== 3) return null
  const [scenario, test_spec, idxStr] = parts
  if (!scenario || !test_spec) return null
  const index = Number(idxStr)
  if (!Number.isInteger(index) || index < 0) return null
  return { scenario, test_spec, index }
}

// Generic storage for the three TS-source content types. We only persist the
// source text — validation (duck-typed shape check) is orthogonal and stays
// in shared/validate.ts.
export interface TsSource {
  source: string
}
