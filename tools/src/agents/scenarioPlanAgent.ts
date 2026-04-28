import type { Tool } from '../framework.js'
import { runAgent, type AgentRunResult, type ResponseSpec } from '../../../shared/agentLoop.js'
import { withRunLog } from '../../../shared/logContext.js'
import { INSERT_SCENARIO_PLAN_TOOL } from '../insertScenarioPlan/index.js'
import { loadSkill } from './_loadPrompt.js'

export interface ScenarioPlanAgentResponse {
  plan_name: string
  success: boolean
  failure_reason_summary: string
}

export const SCENARIO_PLAN_RESPONSE_SPEC: ResponseSpec = {
  description:
    '{ plan_name, success, failure_reason_summary } — plan_name is the slug ' +
    'you wrote (matches insert_scenario_plan.plan_id); success is true iff ' +
    'the plan validated and was persisted; failure_reason_summary is a short ' +
    'explanation of what blocked success (empty string when success=true).',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['plan_name', 'success', 'failure_reason_summary'],
    properties: {
      plan_name: {
        type: 'string',
        description: 'Slug of the plan written (matches insert_scenario_plan.plan_id).',
      },
      success: {
        type: 'boolean',
        description: 'True iff the plan validated and was persisted.',
      },
      failure_reason_summary: {
        type: 'string',
        description: 'Short reason if success=false; empty string otherwise.',
      },
    },
  },
}

export async function runScenarioPlanAgent(
  userPrompt: string,
  opts: { verbose?: boolean; maxIterations?: number } = {},
): Promise<AgentRunResult<ScenarioPlanAgentResponse>> {
  return withRunLog('scenario-plan-agent', { prompt: userPrompt }, () =>
    runAgent<ScenarioPlanAgentResponse>({
      systemPrompt: loadSkill('scenario-plan-agent'),
      userPrompt,
      tools: [INSERT_SCENARIO_PLAN_TOOL as Tool],
      responseSpec: SCENARIO_PLAN_RESPONSE_SPEC,
      verbose: opts.verbose,
      maxIterations: opts.maxIterations,
    }),
  )
}
