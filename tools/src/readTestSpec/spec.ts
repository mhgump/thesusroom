import type { ToolSpec } from '../framework.js'
import type { RunScenarioSpec } from '../_shared/runScenarioSpec.js'

export interface ReadTestSpecInput {
  test_spec_name: string
}

export type ReadTestSpecOutput = RunScenarioSpec | { error: string }

export const READ_TEST_SPEC_SPEC: ToolSpec = {
  name: 'read_test_spec',
  description:
    'Read a test spec at content/test_specs/{test_spec_name}.json and return ' +
    'the full spec — scenario_id, map_id, bots, opts, notes, ' +
    'last_run_artifact_ids. Returns {error} if the file is missing or ' +
    'malformed.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['test_spec_name'],
    properties: {
      test_spec_name: {
        type: 'string',
        description: 'Slug of the spec to read.',
      },
    },
  },
}
