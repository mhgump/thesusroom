import type { Tool } from '../framework.js'
import { getDataBackend } from '../_shared/backends/index.js'
import { parseRunResultKey } from '../_shared/backends/types.js'
import { parseLogs } from '../_shared/logFormat.js'
import {
  GET_SCENARIO_LOGS_SPEC,
  type GetScenarioLogsInput,
  type GetScenarioLogsOutput,
  type LogLine,
} from './spec.js'

function validateInput(input: unknown): GetScenarioLogsInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<GetScenarioLogsInput>
  if (typeof i.run_artifact_id !== 'string' || !i.run_artifact_id) {
    throw new Error('run_artifact_id must be a non-empty string')
  }
  return i as GetScenarioLogsInput
}

function isWebsocketError(message: string): boolean {
  return /ws error[: ]|websocket error|WebSocket error/i.test(message)
}

async function run(rawInput: unknown): Promise<GetScenarioLogsOutput> {
  const input = validateInput(rawInput)
  const key = parseRunResultKey(input.run_artifact_id)
  if (key === null) {
    return {
      scenario_script_logs: [],
      scenario_script_errors: [
        { time: 0, level: 'error', message: `invalid run_artifact_id: ${input.run_artifact_id}` },
      ],
      websocket_errors: [],
      success: false,
    }
  }
  const { scenarioRunResult } = getDataBackend()
  const artifact = await scenarioRunResult.get(key)
  if (artifact === null) {
    return {
      scenario_script_logs: [],
      scenario_script_errors: [
        { time: 0, level: 'error', message: `artifact not found: ${input.run_artifact_id}` },
      ],
      websocket_errors: [],
      success: false,
    }
  }

  const scenario_script_logs: LogLine[] = []
  const scenario_script_errors: LogLine[] = []
  const websocket_errors: LogLine[] = []

  // `dateMs` anchors the date for the time-of-day prefix. Using Date.now()
  // is fine: entries share the run's day and only relative order matters.
  const now = Date.now()
  const serverEntries = parseLogs(artifact.server_logs, now)
  const botEntries = parseLogs(artifact.logs, now)

  for (const s of serverEntries) {
    const line: LogLine = { time: s.time, level: s.level, message: s.message }
    if (isWebsocketError(s.message)) {
      websocket_errors.push(line)
      continue
    }
    if (s.level === 'error') scenario_script_errors.push(line)
    else scenario_script_logs.push(line)
  }

  // Also surface any ws-error entries that showed up in bot client logs.
  for (const log of botEntries) {
    if (isWebsocketError(log.message)) {
      websocket_errors.push({ time: log.time, level: log.level, message: log.message })
    }
  }

  websocket_errors.sort((a, b) => a.time - b.time)

  const success =
    artifact.termination_metadata.terminated_by === 'scenario' &&
    artifact.termination_metadata.exit_code === 0 &&
    scenario_script_errors.length === 0

  return {
    scenario_script_logs,
    scenario_script_errors,
    websocket_errors,
    success,
  }
}

export const GET_SCENARIO_LOGS_TOOL: Tool<GetScenarioLogsInput, GetScenarioLogsOutput> = {
  spec: GET_SCENARIO_LOGS_SPEC,
  run: run as (input: GetScenarioLogsInput) => Promise<GetScenarioLogsOutput>,
}
