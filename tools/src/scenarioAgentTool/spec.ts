import type { ToolSpec } from '../framework.js'
import type { ScenarioAgentResponse } from '../agents/scenarioAgent.js'

export interface ScenarioAgentToolInput {
  prompt: string
}

export type ScenarioAgentToolOutput = ScenarioAgentResponse

export const SCENARIO_AGENT_SPEC: ToolSpec = {
  name: 'scenario_agent',
  description:
    'Delegate to a Scenario Agent that designs a ScenarioSpec tied to an ' +
    'existing map, persists it to content/scenarios/{scenario_id}.ts, and ' +
    'iterates until the file parses and validates. Returns ' +
    '{scenario_name, success, failure_reason_summary}.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['prompt'],
    properties: {
      prompt: {
        type: 'string',
        description:
          'Instruction for the scenario agent — which map to tie to, desired ' +
          'scripted behavior, timeouts, and any constraints.',
      },
    },
  },
}
