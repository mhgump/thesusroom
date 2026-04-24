import type { ToolSpec } from '../framework.js'
import type { DirectAgentResponse } from '../agents/directAgent.js'

export interface DirectAgentToolInput {
  prompt: string
}

export type DirectAgentToolOutput = DirectAgentResponse

export const DIRECT_AGENT_SPEC: ToolSpec = {
  name: 'direct_agent',
  description:
    'Delegate to a Direct Modification Agent that drives a gameplay goal ' +
    'end-to-end by alternating edits (map/scenario/bot changes) with runs ' +
    '(scenario execution + log inspection). Returns ' +
    '{goal_achieved, summary, failure_reason_summary, iterations_used, ' +
    'test_spec_name}. The top-level create-scenario agent uses this for ' +
    'per-outcome iteration — each outcome\'s brief should specify the ' +
    'required test_spec_name, composition, and expected survivor count.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['prompt'],
    properties: {
      prompt: {
        type: 'string',
        description:
          'Instruction for the direct agent — the goal it should drive to ' +
          'completion, including the required test_spec_name, persona ' +
          'composition, and expected survivor count for the run it should ' +
          'validate.',
      },
    },
  },
}
