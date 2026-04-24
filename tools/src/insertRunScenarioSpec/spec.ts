import type { ToolSpec } from '../framework.js'

export interface InsertRunScenarioSpecInputBot {
  path: string
  export: string
}

export interface InsertRunScenarioSpecInputOpts {
  record_video_bot_index?: number
  timeout_ms?: number
  collect_log_bot_indices?: number[]
}

export interface InsertRunScenarioSpecInputNote {
  author: string
  text: string
}

export interface InsertRunScenarioSpecInput {
  name: string
  scenario_id: string
  map_id: string
  bots: InsertRunScenarioSpecInputBot[]
  opts?: InsertRunScenarioSpecInputOpts
  notes?: InsertRunScenarioSpecInputNote[]
  // Bot index whose POV best demonstrates this outcome. Defaults to 0.
  // Must be in [0, bots.length). The create-scenario orchestrator re-runs
  // each validated spec with record_video_bot_index = hero_index to produce
  // a recording.
  hero_index?: number
}

export type InsertRunScenarioSpecOutput =
  | { success: true; test_spec_name: string }
  | { success: false; error: string }

export const INSERT_RUN_SCENARIO_SPEC_SPEC: ToolSpec = {
  name: 'insert_run_scenario_spec',
  description:
    'Create or replace a run-scenario test spec at ' +
    'content/scenarios/{scenario_id}/test_specs/{name}/spec.json. Captures ' +
    'the scenario_id, map_id, bot refs, and run opts that define one attempt; ' +
    'notes are set to whatever is passed (default []) and are replaced wholesale — ' +
    'use add_notes_to_test_spec to append reasoning after creation. Validates ' +
    'that the scenario / map files and every bot path exist, and that opts ' +
    'indices are within range. Returns {success:true, test_spec_name} on ' +
    'success, {success:false, error} on validation failure (no file is written).',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'scenario_id', 'map_id', 'bots'],
    properties: {
      name: {
        type: 'string',
        description:
          'Slug for the spec. Stored at content/scenarios/{scenario_id}/test_specs/{name}/spec.json.',
      },
      scenario_id: {
        type: 'string',
        description: 'Scenario slug — content/scenarios/{scenario_id}/scenario.ts must exist.',
      },
      map_id: {
        type: 'string',
        description: 'Map slug — content/maps/{map_id}/map.ts must exist.',
      },
      bots: {
        type: 'array',
        description: 'Ordered list of bot references.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'export'],
          properties: {
            path: {
              type: 'string',
              description: 'Repo-root-relative path, e.g. "content/bots/scenario2/filler/bot.ts".',
            },
            export: {
              type: 'string',
              description: 'Exported BotSpec name, e.g. "SCENARIO2_BOT".',
            },
          },
        },
      },
      opts: {
        type: 'object',
        additionalProperties: false,
        description: 'Optional knobs for the run — all fields optional.',
        properties: {
          record_video_bot_index: {
            type: 'integer',
            minimum: 0,
            description: 'Bot index whose POV to record to video.',
          },
          timeout_ms: {
            type: 'integer',
            minimum: 1,
            description: 'Scenario timeout override (ms).',
          },
          collect_log_bot_indices: {
            type: 'array',
            items: { type: 'integer', minimum: 0 },
            description: 'Bot indices whose logs to prioritise.',
          },
        },
      },
      notes: {
        type: 'array',
        description:
          'Initial notes to seed the spec with. Each entry is timestamped by ' +
          'the tool. The notes array is a full replace — pass [] (or omit) ' +
          'for a fresh spec.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['author', 'text'],
          properties: {
            author: { type: 'string' },
            text: { type: 'string' },
          },
        },
      },
      hero_index: {
        type: 'integer',
        minimum: 0,
        description:
          'Bot index whose POV best demonstrates this outcome. Must be in ' +
          '[0, bots.length). Defaults to 0. Used by the orchestrator when ' +
          're-running the spec with video recording enabled.',
      },
    },
  },
}
