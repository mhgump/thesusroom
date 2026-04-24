import type { ToolSpec } from '../framework.js'

export interface ListContentInput {
  scenario_name_regex?: string
  map_name_regex?: string
  // Regex pattern matched against the bot filename slug; named for backwards
  // compatibility with the original spec even though it accepts a regex.
  bot_spec_name?: string
  test_spec_name_regex?: string
  for_scenarios?: boolean
  for_maps?: boolean
  for_bots?: boolean
  for_test_specs?: boolean
}

export interface ListedScenario {
  name: string
  index: number
  path: string
}

export interface ListedMap {
  name: string
  path: string
}

export interface ListedBot {
  name: string
  scenario_id: string
  path: string
}

export interface ListedTestSpec {
  name: string
  index: number
  path: string
  scenario_id: string
  map_id: string
  bot_count: number
  note_count: number
}

export interface ListContentOutput {
  scenarios: ListedScenario[]
  maps: ListedMap[]
  bots: ListedBot[]
  // Test specs grouped by scenario_id. Scenarios with no test specs are
  // still present with an empty array.
  test_specs: Record<string, ListedTestSpec[]>
}

export const LIST_CONTENT_SPEC: ToolSpec = {
  name: 'list_content',
  description:
    'Enumerate scenarios, maps, bots, and test specs under content/. Each ' +
    'category can be filtered by a regex pattern matched against the slug ' +
    '(filename without extension). The bot filter param is named ' +
    '`bot_spec_name` for historical reasons but is treated as a regex pattern ' +
    'like the others. If none of the for_* flags are set, all four categories ' +
    'are returned; if any for_* flag is true, only the flagged categories ' +
    'are populated (others come back empty). Test specs are grouped by ' +
    'scenario_id. Paths are repo-root relative. Scenarios and test specs ' +
    'include their integer `index` from content/scenario_map.json / ' +
    'content/scenarios/{scenario}/test_specs.json.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      scenario_name_regex: {
        type: 'string',
        description: 'Regex filtering scenario slugs. Defaults to ".*".',
      },
      map_name_regex: {
        type: 'string',
        description: 'Regex filtering map slugs. Defaults to ".*".',
      },
      bot_spec_name: {
        type: 'string',
        description:
          'Regex filtering bot slugs (by filename, without extension). ' +
          'Despite the name, treated as a regex. Defaults to ".*".',
      },
      test_spec_name_regex: {
        type: 'string',
        description: 'Regex filtering test-spec slugs. Defaults to ".*".',
      },
      for_scenarios: {
        type: 'boolean',
        description: 'Include scenarios in output.',
      },
      for_maps: {
        type: 'boolean',
        description: 'Include maps in output.',
      },
      for_bots: {
        type: 'boolean',
        description: 'Include bots in output.',
      },
      for_test_specs: {
        type: 'boolean',
        description: 'Include test specs in output.',
      },
    },
  },
}
