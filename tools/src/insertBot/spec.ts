import type { ToolSpec } from '../framework.js'

export interface InsertBotInput {
  // Slug for the bot file, e.g. "aggressiveBot". Used as the filename:
  // content/bots/{scenario_id}/{bot_id}.ts.
  bot_id: string
  // The scenario this bot belongs to. Must correspond to an existing scenario
  // file at content/scenarios/{scenario_id}.ts.
  scenario_id: string
  // Name of the exported BotSpec in the file, e.g. "AGGRESSIVE_BOT".
  export_name: string
  // Full TypeScript source for content/bots/{scenario_id}/{bot_id}.ts.
  file_content: string
}

export type InsertBotOutput =
  | { success: true }
  | { success: false; error: string }

export const INSERT_BOT_SPEC: ToolSpec = {
  name: 'insert_bot',
  description:
    'Create or overwrite a bot at content/bots/{scenario_id}/{bot_id}.ts from ' +
    'the provided TypeScript source. The bot is tied to a scenario via ' +
    'scenario_id; the corresponding content/scenarios/{scenario_id}.ts must ' +
    'already exist. Validates that the file exports a valid BotSpec. Returns ' +
    '{success:true} on success, {success:false, error} on parse/validation failure.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['bot_id', 'scenario_id', 'export_name', 'file_content'],
    properties: {
      bot_id: {
        type: 'string',
        description: 'Bot slug. Used as filename under content/bots/{scenario_id}/.',
      },
      scenario_id: {
        type: 'string',
        description: 'Scenario slug this bot belongs to (must exist at content/scenarios/{scenario_id}.ts).',
      },
      export_name: {
        type: 'string',
        description: 'The exported BotSpec constant name (e.g. "AGGRESSIVE_BOT").',
      },
      file_content: {
        type: 'string',
        description: 'Full TypeScript source written to content/bots/{scenario_id}/{bot_id}.ts.',
      },
    },
  },
}
