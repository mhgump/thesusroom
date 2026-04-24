import type { ToolSpec } from '../framework.js'

export interface BotPersona {
  name: string
  description: string
}

export interface OutcomePersonaCount {
  name: string
  count: number
}

export interface ExpectedOutcome {
  expected_survivors: number
  personas: OutcomePersonaCount[]
}

export interface InsertScenarioPlanInput {
  plan_id: string
  concept_description: string
  scenario_sketch: string
  possible_outcomes_description: string
  outcomes_test_plan: string
  min_player_count: number
  max_player_count: number
  bot_personas: BotPersona[]
  outcomes: ExpectedOutcome[]
}

export type InsertScenarioPlanOutput =
  | { success: true; path: string }
  | { success: false; error: string }

export const INSERT_SCENARIO_PLAN_SPEC: ToolSpec = {
  name: 'insert_scenario_plan',
  description:
    'Create or overwrite a scenario plan at ' +
    'content/scenario_plans/{plan_id}.json. A plan is the pre-build design ' +
    'doc: concept, sketch, player-count bounds, bot personas, and the ' +
    'outcomes the test set must demonstrate. Validates internal consistency ' +
    '(persona names, player-count bounds, survivor counts) — returns ' +
    '{success:true, path} on success, {success:false, error} on validation ' +
    'failure.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'plan_id',
      'concept_description',
      'scenario_sketch',
      'possible_outcomes_description',
      'outcomes_test_plan',
      'min_player_count',
      'max_player_count',
      'bot_personas',
      'outcomes',
    ],
    properties: {
      plan_id: {
        type: 'string',
        description: 'Slug; becomes the filename under content/scenario_plans/.',
      },
      concept_description: {
        type: 'string',
        description: 'One- or two-sentence elevator pitch for the scenario.',
      },
      scenario_sketch: {
        type: 'string',
        description:
          'Concrete sketch of rooms, triggers, and timing — enough that a ' +
          'scenario agent could implement it.',
      },
      possible_outcomes_description: {
        type: 'string',
        description:
          'High-level description of the space of results the scenario can produce.',
      },
      outcomes_test_plan: {
        type: 'string',
        description:
          'Which specific outcomes the outcomes[] array will demonstrate, and ' +
          'why that subset is sufficient.',
      },
      min_player_count: {
        type: 'integer',
        minimum: 1,
        description: 'Lowest player+bot count the scenario supports.',
      },
      max_player_count: {
        type: 'integer',
        minimum: 1,
        description: 'Highest player+bot count the scenario supports.',
      },
      bot_personas: {
        type: 'array',
        minItems: 1,
        description: 'Bot roles referenced by outcomes[]. Names must be unique.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'description'],
          properties: {
            name: { type: 'string', description: 'Short slug-like role name.' },
            description: {
              type: 'string',
              description: 'What this bot does in the scenario (operational, not flavor).',
            },
          },
        },
      },
      outcomes: {
        type: 'array',
        minItems: 1,
        description:
          'Test cases the scenario should demonstrate. Each outcome fixes a bot ' +
          'composition and the expected survivor count.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['expected_survivors', 'personas'],
          properties: {
            expected_survivors: {
              type: 'integer',
              minimum: 0,
              description: 'How many bots should survive this outcome run.',
            },
            personas: {
              type: 'array',
              minItems: 1,
              description:
                'Composition for this run. Total count must fall within ' +
                '[min_player_count, max_player_count].',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'count'],
                properties: {
                  name: {
                    type: 'string',
                    description: 'Must match a bot_personas[].name.',
                  },
                  count: { type: 'integer', minimum: 1 },
                },
              },
            },
          },
        },
      },
    },
  },
}
