import type { Tool } from '../framework.js'
import { runScenarioPlanAgent } from '../agents/scenarioPlanAgent.js'
import {
  SCENARIO_PLAN_AGENT_SPEC,
  type ScenarioPlanAgentToolInput,
  type ScenarioPlanAgentToolOutput,
} from './spec.js'

function validateInput(input: unknown): ScenarioPlanAgentToolInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<ScenarioPlanAgentToolInput>
  if (typeof i.prompt !== 'string' || !i.prompt) {
    throw new Error('prompt must be a non-empty string')
  }
  return i as ScenarioPlanAgentToolInput
}

async function run(rawInput: unknown): Promise<ScenarioPlanAgentToolOutput> {
  const input = validateInput(rawInput)
  const { response } = await runScenarioPlanAgent(input.prompt)
  return response
}

export const SCENARIO_PLAN_AGENT_TOOL: Tool<
  ScenarioPlanAgentToolInput,
  ScenarioPlanAgentToolOutput
> = {
  spec: SCENARIO_PLAN_AGENT_SPEC,
  run: run as (input: ScenarioPlanAgentToolInput) => Promise<ScenarioPlanAgentToolOutput>,
}
