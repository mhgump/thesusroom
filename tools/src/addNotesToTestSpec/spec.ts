import type { ToolSpec } from '../framework.js'

export interface AddNotesToTestSpecInput {
  scenario_id: string
  test_spec_name: string
  author: string
  text: string
}

export type AddNotesToTestSpecOutput =
  | { success: true; note_count: number }
  | { success: false; error: string }

export const ADD_NOTES_TO_TEST_SPEC_SPEC: ToolSpec = {
  name: 'add_notes_to_test_spec',
  description:
    'Append a note to a test spec\'s notes array. This is the only way to ' +
    'record reasoning / conclusions about a spec — notes are append-only, so ' +
    'previous entries are never overwritten. The tool stamps the note with ' +
    'Date.now(). Returns {success:true, note_count} (total notes after the ' +
    'append) or {success:false, error}.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['scenario_id', 'test_spec_name', 'author', 'text'],
    properties: {
      scenario_id: {
        type: 'string',
        description: 'Scenario slug the test spec belongs to.',
      },
      test_spec_name: {
        type: 'string',
        description: 'Slug of the spec to append to.',
      },
      author: {
        type: 'string',
        description: 'Who authored the note (e.g. "run-scenario-agent").',
      },
      text: {
        type: 'string',
        description: 'Note content — typically the agent\'s conclusion for this attempt.',
      },
    },
  },
}
