import type { ToolSpec } from '../framework.js'
import type { RunScenarioSpec } from '../../../shared/runScenarioSpec.js'

export interface ReadTestSpecInput {
  scenario_id: string
  test_spec_name: string
}

export type ReadTestSpecOutput = RunScenarioSpec | { error: string }

export const READ_TEST_SPEC_SPEC: ToolSpec = {
  name: 'read_test_spec',
  description:
    'Read a test spec at content/scenarios/{scenario_id}/test_specs/{test_spec_name}/spec.json ' +
    'and return the full spec — scenario_id, map_id, bots, opts, notes, ' +
    'last_run_artifact_ids. Returns {error} if the file is missing or malformed.',
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
        description: 'Slug of the spec to read.',
      },
    },
  },
}
