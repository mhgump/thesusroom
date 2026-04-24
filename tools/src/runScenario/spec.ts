import type { ToolSpec } from '../framework.js'

export interface RunScenarioInput {
  // Scenario identifier (as registered in react-three-capacitor/server/scripts/run-scenario.ts).
  scenario_id: string
  // Bot specs to connect, in order. Each is a reference into content/ resolved as
  //   {path}:{export_name}   e.g. "content/bots/demo/demoBot.ts:DEMO_BOT"
  bots: { path: string; export: string }[]
  // Optional bot index to record video for. Must be < bots.length when set.
  record_video_bot_index?: number
  // Optional list of bot indices to collect logs from. Omit for "all bots".
  // Empty array means no bot logs.
  collect_log_bot_indices?: number[]
  // Optional override for the scenario timeout (ms).
  timeout_ms?: number
}

export interface RunScenarioLogEntry {
  time: number
  level: 'info' | 'warn' | 'error'
  source: 'cli-bot' | 'scenario-bot'
  bot_index: number
  message: string
}

export interface RunScenarioOutput {
  run_id: string
  scenario_id: string
  bot_count: number
  record_bot_index: number | null
  log_bot_indices: number[] | null
  effective_timeout_ms: number
  terminated_by: 'scenario' | 'timeout'
  logs: RunScenarioLogEntry[]
  // Absolute path — only set when recording was requested.
  video_path: string | null
  screenshot_path: string | null
  screenshot_has_content: boolean | null
  output_dir: string
  exit_code: number
}

export const RUN_SCENARIO_SPEC: ToolSpec = {
  name: 'run_scenario',
  description:
    'Run a scenario from content/ with a chosen list of bots. Returns structured ' +
    'JSON with collected bot logs and (optionally) a recorded video of one bot\'s ' +
    'point of view. The video, screenshot, and JSON response are also written to ' +
    'data/scenario_runs/{run_id}/ on disk.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['scenario_id', 'bots'],
    properties: {
      scenario_id: {
        type: 'string',
        description:
          'Scenario to load from content/scenarios/. One of: demo, scenario1, ' +
          'scenario2, scenario3, scenario4.',
      },
      bots: {
        type: 'array',
        description:
          'Ordered list of bot specs. Each refers to an exported BotSpec inside ' +
          'content/. The bot\'s index in this array is its index in the scenario.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'export'],
          properties: {
            path: {
              type: 'string',
              description:
                'Path (relative to repo root) to a .ts module that exports a ' +
                'BotSpec, e.g. "content/bots/demo/demoBot.ts".',
            },
            export: {
              type: 'string',
              description: 'Name of the exported BotSpec, e.g. "DEMO_BOT".',
            },
          },
        },
      },
      record_video_bot_index: {
        type: 'integer',
        minimum: 0,
        description:
          'Bot index whose point-of-view to record as video. Must be < bots.length. ' +
          'If omitted, no video is recorded.',
      },
      collect_log_bot_indices: {
        type: 'array',
        items: { type: 'integer', minimum: 0 },
        description:
          'Indices of bots whose logs should be collected. Omit to collect logs ' +
          'from every bot; pass an empty array to collect no bot logs.',
      },
      timeout_ms: {
        type: 'integer',
        minimum: 1,
        description: 'Override for the scenario\'s default timeout.',
      },
    },
  },
}
