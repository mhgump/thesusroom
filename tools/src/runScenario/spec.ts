import type { ToolSpec } from '../framework.js'

export interface RunScenarioInput {
  // Scenario identifier (as registered in react-three-capacitor/server/scripts/run-scenario.ts).
  scenario_id: string
  // Optional test-spec name. Used as the middle segment of the run's storage key
  // (content/scenario_runs/{scenario}/{test_spec}/{index}/). Omit for direct runs
  // not driven by a named spec — '_adhoc' is substituted.
  test_spec_name?: string
  // Bot specs to connect, in order. Each is a reference into content/ resolved as
  //   {path}:{export_name}   e.g. "content/bots/demo/demoBot/bot.ts:DEMO_BOT"
  bots: { path: string; export: string }[]
  // Optional bot index to record video for. Must be < bots.length when set.
  record_video_bot_index?: number
  // Optional list of bot indices to collect logs from. Omit for "all bots".
  // Empty array means no bot logs.
  collect_log_bot_indices?: number[]
  // Optional override for the scenario timeout (ms).
  timeout_ms?: number
}

// Wire shape of content/scenario_runs/{scenario}/{test_spec}/{index}/response.json.
// The writer (react-three-capacitor/server/scripts/run-scenario.ts) produces
// this; readers in tools/src/ parse `logs` / `server_logs` with parseLogs()
// from _shared/logFormat.ts.
export interface ScenarioRunResult {
  // Canonical string form of the RunResultKey: "<scenario>/<test_spec>/<index>".
  run_id: string
  output_dir: string
  config: {
    scenario_id: string
    test_spec_name: string
    index: number
    bot_count: number
    record_bot_index: number | null
    log_bot_indices: number[] | null
    effective_timeout_ms: number
  }
  // Text block, one LogEntry per line — see _shared/logFormat.ts.
  logs: string
  termination_metadata: {
    terminated_by: 'scenario' | 'timeout'
    exit_code: number
    video_path: string | null
    screenshot_path: string | null
    screenshot_has_content: boolean | null
    observer_ready_fired: boolean
  }
  // Text block, one LogEntry per line — see _shared/logFormat.ts.
  server_logs: string
}

export const RUN_SCENARIO_SPEC: ToolSpec = {
  name: 'run_scenario',
  description:
    'Run a scenario from content/ with a chosen list of bots. Returns structured ' +
    'JSON with collected bot logs and (optionally) a recorded video of one bot\'s ' +
    'point of view. The video, screenshot, and JSON response are persisted via ' +
    'the configured data backend; for the filesystem backend they live under ' +
    'content/scenario_runs/{scenario}/{test_spec}/{index}/.',
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
      test_spec_name: {
        type: 'string',
        description:
          'Optional test-spec name this run belongs to. Becomes the middle ' +
          'segment of the storage key. Omit for ad-hoc runs.',
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
                'BotSpec, e.g. "content/bots/demo/demoBot/bot.ts".',
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
