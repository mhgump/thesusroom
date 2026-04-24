import fs from 'node:fs'
import path from 'node:path'
import type { Tool } from '../framework.js'
import { TEST_SPECS_DIR } from '../_shared/paths.js'
import type { RunScenarioSpec } from '../_shared/runScenarioSpec.js'
import {
  RUN_SCENARIO_WITH_BOTS_TOOL,
  type RunScenarioWithBotsInput,
} from '../runScenarioWithBots/index.js'
import {
  RUN_SCENARIO_FROM_SPEC_SPEC,
  type RunScenarioFromSpecInput,
  type RunScenarioFromSpecOutput,
} from './spec.js'

const SLUG_RE = /^[a-zA-Z0-9_-]+$/

function validateInput(input: unknown): RunScenarioFromSpecInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<RunScenarioFromSpecInput>
  if (typeof i.test_spec_name !== 'string' || !i.test_spec_name) {
    throw new Error('test_spec_name must be a non-empty string')
  }
  if (!SLUG_RE.test(i.test_spec_name)) throw new Error('test_spec_name must match [a-zA-Z0-9_-]+')
  return i as RunScenarioFromSpecInput
}

async function run(rawInput: unknown): Promise<RunScenarioFromSpecOutput> {
  const input = validateInput(rawInput)
  const absSpecPath = path.join(TEST_SPECS_DIR, `${input.test_spec_name}.json`)
  if (!fs.existsSync(absSpecPath)) {
    return { test_spec_name: input.test_spec_name, error: `test spec not found at ${absSpecPath}` }
  }
  let spec: RunScenarioSpec
  try {
    spec = JSON.parse(fs.readFileSync(absSpecPath, 'utf8')) as RunScenarioSpec
  } catch (err) {
    return {
      test_spec_name: input.test_spec_name,
      error: `failed to parse test spec: ${(err as Error).message}`,
    }
  }

  const runInput: RunScenarioWithBotsInput = {
    scenario_id: spec.scenario_id,
    bots: spec.bots,
    record_video_bot_index: spec.opts?.record_video_bot_index,
    timeout_ms: spec.opts?.timeout_ms,
  }

  const result = await RUN_SCENARIO_WITH_BOTS_TOOL.run(runInput)

  // Append run_artifact_id to the spec so notes / log-fetchers can tie each
  // note trail back to a specific run.
  if (result.run_artifact_id) {
    if (!Array.isArray(spec.last_run_artifact_ids)) spec.last_run_artifact_ids = []
    spec.last_run_artifact_ids.push(result.run_artifact_id)
    fs.writeFileSync(absSpecPath, JSON.stringify(spec, null, 2) + '\n')
  }

  return { test_spec_name: input.test_spec_name, ...result }
}

export const RUN_SCENARIO_FROM_SPEC_TOOL: Tool<
  RunScenarioFromSpecInput,
  RunScenarioFromSpecOutput
> = {
  spec: RUN_SCENARIO_FROM_SPEC_SPEC,
  run: run as (input: RunScenarioFromSpecInput) => Promise<RunScenarioFromSpecOutput>,
}
