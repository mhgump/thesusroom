import type { ToolSpec } from '../framework.js'
import type { ScenarioPlanAgentResponse } from '../agents/scenarioPlanAgent.js'

export interface ScenarioPlanAgentToolInput {
  prompt: string
}

export type ScenarioPlanAgentToolOutput = ScenarioPlanAgentResponse

export const SCENARIO_PLAN_AGENT_SPEC: ToolSpec = {
  name: 'scenario_plan_agent',
  description:
    'Delegate to a Scenario Plan Agent that turns a natural-language brief ' +
    'into a scenario plan JSON at content/scenario_plans/{plan_id}.json, ' +
    'iterating on insert_scenario_plan until it validates. Returns ' +
    '{plan_name, success, failure_reason_summary}. Use this when a brief ' +
    'does not yet have a plan on disk.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['prompt'],
    properties: {
      prompt: {
        type: 'string',
        description:
          'Natural-language brief for the plan agent — concept, outcomes, ' +
          'player count bounds, bot personas. Typically this is the user\'s ' +
          'original request, optionally augmented with the intended slug.',
      },
    },
  },
}
