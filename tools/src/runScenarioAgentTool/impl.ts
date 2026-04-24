import type { Tool } from '../framework.js'
import { runRunScenarioAgent } from '../agents/runScenarioAgent.js'
import {
  RUN_SCENARIO_AGENT_SPEC,
  type RunScenarioAgentToolInput,
  type RunScenarioAgentToolOutput,
} from './spec.js'

function validateInput(input: unknown): RunScenarioAgentToolInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<RunScenarioAgentToolInput>
  if (typeof i.prompt !== 'string' || !i.prompt) {
    throw new Error('prompt must be a non-empty string')
  }
  return i as RunScenarioAgentToolInput
}

async function run(rawInput: unknown): Promise<RunScenarioAgentToolOutput> {
  const input = validateInput(rawInput)
  const { response } = await runRunScenarioAgent(input.prompt)
  return response
}

export const RUN_SCENARIO_AGENT_TOOL: Tool<
  RunScenarioAgentToolInput,
  RunScenarioAgentToolOutput
> = {
  spec: RUN_SCENARIO_AGENT_SPEC,
  run: run as (input: RunScenarioAgentToolInput) => Promise<RunScenarioAgentToolOutput>,
}
