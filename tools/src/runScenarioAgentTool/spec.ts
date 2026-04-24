import type { ToolSpec } from '../framework.js'
import type { RunScenarioAgentResponse } from '../agents/runScenarioAgent.js'

export interface RunScenarioAgentToolInput {
  prompt: string
}

export type RunScenarioAgentToolOutput = RunScenarioAgentResponse

export const RUN_SCENARIO_AGENT_SPEC: ToolSpec = {
  name: 'run_scenario_agent',
  description:
    'Delegate to a Run-Scenario Agent that picks a scenario + bots, persists ' +
    'a test spec under content/scenarios/{scenario_id}/test_specs/{name}/spec.json, ' +
    'runs the scenario, inspects logs, and appends its reasoning to the spec\'s ' +
    'notes array. Returns {scenario_id, test_spec_name, success} — the full trail ' +
    '(scenario/map/bots/opts, notes, run_artifact_ids) lives on disk in the ' +
    'spec; use read_test_spec to load it.',
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
