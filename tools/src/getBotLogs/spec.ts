import type { ToolSpec } from '../framework.js'
import type { LogLine } from '../getScenarioLogs/index.js'

export interface GetBotLogsInput {
  run_artifact_id: string
  // Zero-based bot index as supplied to run_scenario_with_bots.
  bot_id: number
}

export interface GetBotLogsOutput {
  client_logs: LogLine[]
  disconnected: boolean
  bot_script_logs: LogLine[]
}

export const GET_BOT_LOGS_SPEC: ToolSpec = {
  name: 'get_bot_logs',
  description:
    'Read a scenario-run artifact and return a specific bot\'s logs ' +
    'partitioned into {client_logs, disconnected, bot_script_logs}. ' +
    'client_logs covers connection lifecycle; bot_script_logs covers errors ' +
    'thrown from the BotSpec callback code. `disconnected` is true if the bot ' +
    'was eliminated by the server or lost its connection before the scenario ended.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['run_artifact_id', 'bot_id'],
    properties: {
      run_artifact_id: {
        type: 'string',
        description: 'Artifact id returned from run_scenario_with_bots.',
      },
      bot_id: {
        type: 'integer',
        minimum: 0,
        description: 'Zero-based bot index as supplied to run_scenario_with_bots.',
      },
    },
  },
}
