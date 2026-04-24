import type { Tool } from '../framework.js'
import { runAgent, type AgentRunResult, type ResponseSpec } from '../_shared/agentLoop.js'
import { INSERT_SCENARIO_TOOL } from '../insertScenario/index.js'
import { loadSkill } from './_loadPrompt.js'

export interface ScenarioAgentResponse {
  scenario_name: string
  success: boolean
  failure_reason_summary: string
}

export const SCENARIO_RESPONSE_SPEC: ResponseSpec = {
  description:
    '{ scenario_name, success, failure_reason_summary } — scenario_name is the ' +
    'slug you wrote (matches insert_scenario.scenario_id); success is true iff ' +
    'the scenario parsed & validated; failure_reason_summary is a short ' +
    'explanation of what blocked success (empty string when success=true).',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['scenario_name', 'success', 'failure_reason_summary'],
    properties: {
      scenario_name: {
        type: 'string',
        description: 'Slug of the scenario written (matches insert_scenario.scenario_id).',
      },
      success: {
        type: 'boolean',
        description: 'True iff the scenario parsed & validated successfully.',
      },
      failure_reason_summary: {
        type: 'string',
        description: 'Short reason if success=false; empty string otherwise.',
      },
    },
  },
}

export async function runScenarioAgent(
  userPrompt: string,
  opts: { verbose?: boolean; maxIterations?: number } = {},
): Promise<AgentRunResult<ScenarioAgentResponse>> {
  return runAgent<ScenarioAgentResponse>({
    systemPrompt: loadSkill('scenario-agent'),
    userPrompt,
    tools: [INSERT_SCENARIO_TOOL as Tool],
    responseSpec: SCENARIO_RESPONSE_SPEC,
    verbose: opts.verbose,
    maxIterations: opts.maxIterations,
  })
}
