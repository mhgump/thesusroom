import type { Tool } from '../framework.js'
import { runScenarioAgent } from '../agents/scenarioAgent.js'
import {
  SCENARIO_AGENT_SPEC,
  type ScenarioAgentToolInput,
  type ScenarioAgentToolOutput,
} from './spec.js'

function validateInput(input: unknown): ScenarioAgentToolInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<ScenarioAgentToolInput>
  if (typeof i.prompt !== 'string' || !i.prompt) {
    throw new Error('prompt must be a non-empty string')
  }
  return i as ScenarioAgentToolInput
}

async function run(rawInput: unknown): Promise<ScenarioAgentToolOutput> {
  const input = validateInput(rawInput)
  const { response } = await runScenarioAgent(input.prompt)
  return response
}

export const SCENARIO_AGENT_TOOL: Tool<ScenarioAgentToolInput, ScenarioAgentToolOutput> = {
  spec: SCENARIO_AGENT_SPEC,
  run: run as (input: ScenarioAgentToolInput) => Promise<ScenarioAgentToolOutput>,
}
