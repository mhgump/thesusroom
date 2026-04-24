import type { ToolSpec } from '../framework.js'

export interface RunScenarioWithBotsInput {
  // Scenario slug registered in run-scenario.ts.
  scenario_id: string
  // Optional test-spec name this run belongs to. Becomes the middle segment
  // of the storage key; '_adhoc' is used when omitted.
  test_spec_name?: string
  // Bots to connect, in order. Each reference must be importable relative to the repo root.
  bots: { path: string; export: string }[]
  // Optional: bot index whose POV to record to video.
  record_video_bot_index?: number
  // Optional timeout override (ms).
  timeout_ms?: number
}

export interface RunScenarioWithBotsOutput {
  // True if the scenario terminated on its own (not by timeout).
  complete: boolean
  // One-line summary of the run.
  scenario_summary: string
  // Count of bots that were NOT eliminated by the server during the run.
  survivors: number
  // Artifact id — pass into get_scenario_logs / get_bot_logs to fetch log detail.
  run_artifact_id: string
}

export const RUN_SCENARIO_WITH_BOTS_SPEC: ToolSpec = {
  name: 'run_scenario_with_bots',
  description:
    'Run a scenario with the given bots and return a Scenario Summary: ' +
    '{complete, scenario_summary, survivors, run_artifact_id}. run_artifact_id ' +
    'has the form "<scenario>/<test_spec>/<index>" and can be passed into ' +
    'get_scenario_logs and get_bot_logs.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['scenario_id', 'bots'],
    properties: {
      scenario_id: {
        type: 'string',
        description: 'Scenario slug registered in run-scenario.ts.',
      },
      test_spec_name: {
        type: 'string',
        description:
          'Optional test-spec name this run belongs to. Used as the middle ' +
          'segment of the run storage key.',
      },
      bots: {
        type: 'array',
        description: 'Ordered list of bot specs to connect.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'export'],
          properties: {
            path: {
              type: 'string',
              description: 'Path relative to repo root, e.g. "content/bots/scenario2/filler/bot.ts".',
            },
            export: {
              type: 'string',
              description: 'Exported BotSpec name, e.g. "SCENARIO2_BOT".',
            },
          },
        },
      },
      record_video_bot_index: {
        type: 'integer',
        minimum: 0,
        description: 'Optional bot index whose POV to record to video.',
      },
      timeout_ms: {
        type: 'integer',
        minimum: 1,
        description: 'Optional scenario timeout override (ms).',
      },
    },
  },
}
