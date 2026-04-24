import type { ToolSpec } from '../framework.js'
import type { RunScenarioAgentResponse } from '../agents/runScenarioAgent.js'

export interface RunScenarioAgentToolInput {
  prompt: string
}

export type RunScenarioAgentToolOutput = RunScenarioAgentResponse

export const RUN_SCENARIO_AGENT_SPEC: ToolSpec = {
  name: 'run_scenario_agent',
  description:
    'Delegate to a Run-Scenario Agent that runs a scenario with chosen bots, ' +
    'inspects logs, and summarizes whether the prompt\'s goal was achieved. ' +
    'Returns {achieved_goal, summary, failure_reason_summary, run_artifact_id}.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['prompt'],
    properties: {
      prompt: {
        type: 'string',
        description:
          'Instruction for the run-scenario agent — the goal to validate, ' +
          'which scenario + bots to run, and success criteria.',
      },
    },
  },
}
