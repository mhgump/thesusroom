import type { ToolSpec } from '../framework.js'
import type { RunScenarioWithBotsOutput } from '../runScenarioWithBots/index.js'

export interface RunScenarioFromSpecInput {
  scenario_id: string
  test_spec_name: string
}

export type RunScenarioFromSpecOutput =
  | ({ test_spec_name: string } & RunScenarioWithBotsOutput)
  | { test_spec_name: string; error: string }

export const RUN_SCENARIO_FROM_SPEC_SPEC: ToolSpec = {
  name: 'run_scenario_from_spec',
  description:
    'Run a scenario described by a persisted test spec at ' +
    'content/scenarios/{scenario_id}/test_specs/{test_spec_name}/spec.json. ' +
    'Reads the spec, invokes run_scenario_with_bots with the spec\'s ' +
    'scenario_id / bots / opts, and appends the resulting run_artifact_id to ' +
    'the spec\'s last_run_artifact_ids array. Returns the run summary plus ' +
    'test_spec_name, or {test_spec_name, error} if the spec is missing or malformed.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['scenario_id', 'test_spec_name'],
    properties: {
      scenario_id: {
        type: 'string',
        description: 'Scenario slug the test spec belongs to.',
      },
      test_spec_name: {
        type: 'string',
        description: 'Slug of the spec to run.',
      },
    },
  },
}
