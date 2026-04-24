import type { Tool } from '../framework.js'
import { RUN_SCENARIO_TOOL } from '../runScenario/index.js'
import type { RunScenarioInput } from '../runScenario/index.js'
import {
  RUN_SCENARIO_WITH_BOTS_SPEC,
  type RunScenarioWithBotsInput,
  type RunScenarioWithBotsOutput,
} from './spec.js'

function validateInput(input: unknown): RunScenarioWithBotsInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<RunScenarioWithBotsInput>
  if (typeof i.scenario_id !== 'string' || !i.scenario_id) {
    throw new Error('scenario_id must be a non-empty string')
  }
  if (!Array.isArray(i.bots) || i.bots.length === 0) {
    throw new Error('bots must be a non-empty array')
  }
  for (const [idx, b] of i.bots.entries()) {
    if (!b || typeof b !== 'object') throw new Error(`bots[${idx}] must be an object`)
    if (typeof b.path !== 'string' || typeof b.export !== 'string') {
      throw new Error(`bots[${idx}] must have string path + export`)
    }
  }
  return i as RunScenarioWithBotsInput
}

async function run(rawInput: unknown): Promise<RunScenarioWithBotsOutput> {
  const input = validateInput(rawInput)

  const runInput: RunScenarioInput = {
    scenario_id: input.scenario_id,
    test_spec_name: input.test_spec_name,
    bots: input.bots,
    record_video_bot_index: input.record_video_bot_index,
    timeout_ms: input.timeout_ms,
  }

  const raw = await RUN_SCENARIO_TOOL.run(runInput)

  const complete = raw.termination_metadata.terminated_by === 'scenario'
  const survivors = raw.termination_metadata.final_state.survivor_count

  const summary =
    `scenario "${raw.config.scenario_id}" ` +
    `${complete ? 'completed' : `timed out after ${raw.config.effective_timeout_ms}ms`}; ` +
    `${survivors}/${raw.config.bot_count} bots survived.`

  return {
    complete,
    scenario_summary: summary,
    survivors,
    run_artifact_id: raw.run_id,
  }
}

export const RUN_SCENARIO_WITH_BOTS_TOOL: Tool<
  RunScenarioWithBotsInput,
  RunScenarioWithBotsOutput
> = {
  spec: RUN_SCENARIO_WITH_BOTS_SPEC,
  run: run as (input: RunScenarioWithBotsInput) => Promise<RunScenarioWithBotsOutput>,
}
