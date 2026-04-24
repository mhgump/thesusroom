import type { Tool } from '../framework.js'
import { getDataBackend } from '../_shared/backends/index.js'
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
  if (typeof i.scenario_id !== 'string' || !i.scenario_id) {
    throw new Error('scenario_id must be a non-empty string')
  }
  if (!SLUG_RE.test(i.scenario_id)) throw new Error('scenario_id must match [a-zA-Z0-9_-]+')
  if (typeof i.test_spec_name !== 'string' || !i.test_spec_name) {
    throw new Error('test_spec_name must be a non-empty string')
  }
  if (!SLUG_RE.test(i.test_spec_name)) throw new Error('test_spec_name must match [a-zA-Z0-9_-]+')
  return i as RunScenarioFromSpecInput
}

async function run(rawInput: unknown): Promise<RunScenarioFromSpecOutput> {
  const input = validateInput(rawInput)
  const { testSpec } = getDataBackend()
  const key = { scenario_id: input.scenario_id, test_spec_id: input.test_spec_name }
  const spec = await testSpec.get(key)
  if (spec === null) {
    return {
      test_spec_name: input.test_spec_name,
      error: `test spec not found: ${input.scenario_id}/${input.test_spec_name}`,
    }
  }

  const runInput: RunScenarioWithBotsInput = {
    scenario_id: spec.scenario_id,
    test_spec_name: input.test_spec_name,
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
    await testSpec.put(key, spec)
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
