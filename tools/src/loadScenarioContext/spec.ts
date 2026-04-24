import type { ToolSpec } from '../framework.js'
import type { RunScenarioSpec } from '../_shared/runScenarioSpec.js'

export interface LoadScenarioContextInput {
  scenario_id: string
}

export interface LoadedBot {
  bot_id: string
  path: string
  source: string
}

export interface LoadedTestSpec {
  name: string
  path: string
  spec: RunScenarioSpec
}

export type LoadScenarioContextOutput = {
  scenario_id: string
  exists: {
    plan: boolean
    map: boolean
    scenario: boolean
    // Number of bots found under content/bots/{scenario_id}/.
    bot_count: number
    // Number of test specs found under content/scenarios/{scenario_id}/test_specs/.
    test_spec_count: number
  }
  plan: {
    path: string
    json: unknown
  } | null
  map: {
    path: string
    source: string
  } | null
  scenario: {
    path: string
    source: string
  } | null
  bots: LoadedBot[]
  test_specs: LoadedTestSpec[]
}

export const LOAD_SCENARIO_CONTEXT_SPEC: ToolSpec = {
  name: 'load_scenario_context',
  description:
    'Load every asset attached to a scenario slug in one call: the scenario ' +
    'plan JSON (content/scenario_plans/{scenario_id}.json), the map source ' +
    '(content/maps/{scenario_id}/map.ts), the scenario source ' +
    '(content/scenarios/{scenario_id}/scenario.ts), all bot sources ' +
    '(content/bots/{scenario_id}/*/bot.ts), and every test spec in full ' +
    '(content/scenarios/{scenario_id}/test_specs/*/spec.json). Each field is ' +
    'null when the corresponding file does not exist, and the top-level ' +
    '`exists` block says at a glance which of the five asset types are ' +
    'present — use this before deciding whether to regenerate or reuse each ' +
    'asset when the brief names an existing scenario.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['scenario_id'],
    properties: {
      scenario_id: {
        type: 'string',
        description:
          'Scenario slug to load. Plan / map / bot slugs are assumed to ' +
          'match the scenario slug (the create-scenario orchestrator always ' +
          'uses a single slug for all four).',
      },
    },
  },
}
