import type { ToolSpec } from '../framework.js'

export interface GetScenarioLogsInput {
  run_artifact_id: string
}

export interface LogLine {
  time: number
  level: 'info' | 'warn' | 'error'
  message: string
}

export interface GetScenarioLogsOutput {
  scenario_script_logs: LogLine[]
  scenario_script_errors: LogLine[]
  websocket_errors: LogLine[]
  success: boolean
}

export const GET_SCENARIO_LOGS_SPEC: ToolSpec = {
  name: 'get_scenario_logs',
  description:
    'Read a scenario-run artifact and return scenario-script logs partitioned ' +
    'into {scenario_script_logs, scenario_script_errors, websocket_errors, ' +
    'success}. Pass run_artifact_id returned from run_scenario_with_bots.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['run_artifact_id'],
    properties: {
      run_artifact_id: {
        type: 'string',
        description: 'Artifact id returned from run_scenario_with_bots.',
      },
    },
  },
}
