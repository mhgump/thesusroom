import type { Tool } from '../framework.js'
import { RUN_SCENARIO_TOOL } from '../runScenario/index.js'
import type { RunScenarioInput, RunScenarioOutput } from '../runScenario/index.js'
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

// A bot is considered eliminated if its own log stream contains an "eliminated
// by server" warning (BotClient emits this on player_left for its own id).
function countSurvivors(out: RunScenarioOutput): number {
  const eliminated = new Set<number>()
  for (const log of out.logs) {
    if (log.source !== 'cli-bot') continue
    if (log.message.includes('eliminated by server')) eliminated.add(log.bot_index)
  }
  return Math.max(0, out.bot_count - eliminated.size)
}

async function run(rawInput: unknown): Promise<RunScenarioWithBotsOutput> {
  const input = validateInput(rawInput)

  const runInput: RunScenarioInput = {
    scenario_id: input.scenario_id,
    bots: input.bots,
    record_video_bot_index: input.record_video_bot_index,
    timeout_ms: input.timeout_ms,
  }

  const raw = await RUN_SCENARIO_TOOL.run(runInput)

  const complete = raw.terminated_by === 'scenario'
  const survivors = countSurvivors(raw)

  const summary =
    `scenario "${raw.scenario_id}" ` +
    `${complete ? 'completed' : `timed out after ${raw.effective_timeout_ms}ms`}; ` +
    `${survivors}/${raw.bot_count} bots survived.`

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
