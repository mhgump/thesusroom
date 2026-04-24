import fs from 'node:fs'
import path from 'node:path'
import { SCENARIO_RUNS_DIR } from './paths.js'
import type { RunScenarioOutput } from '../runScenario/index.js'

// Wire-level shape of data/scenario_runs/{id}/response.json. Matches
// RunScenarioOutput once run-scenario.ts + runScenario impl enrich it with
// run_id/output_dir.
export type Artifact = RunScenarioOutput

export function readArtifact(runId: string): Artifact | { error: string } {
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
    return { error: `invalid run_artifact_id: ${runId}` }
  }
  const responsePath = path.join(SCENARIO_RUNS_DIR, runId, 'response.json')
  if (!fs.existsSync(responsePath)) {
    return { error: `artifact not found: ${responsePath}` }
  }
  try {
    return JSON.parse(fs.readFileSync(responsePath, 'utf8')) as Artifact
  } catch (err) {
    return { error: `failed to parse ${responsePath}: ${(err as Error).message}` }
  }
}
