import type { Tool } from '../framework.js'
import { readArtifact } from '../_shared/artifact.js'
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
  const artifact = readArtifact(input.run_artifact_id)
  if ('error' in artifact) {
    return {
      scenario_script_logs: [],
      scenario_script_errors: [{ time: 0, level: 'error', message: artifact.error }],
      websocket_errors: [],
      success: false,
    }
  }

  const scenario_script_logs: LogLine[] = []
  const scenario_script_errors: LogLine[] = []
  const websocket_errors: LogLine[] = []

  for (const s of artifact.server_logs ?? []) {
    const line: LogLine = { time: s.time, level: s.level, message: s.message }
    if (isWebsocketError(s.message)) {
      websocket_errors.push(line)
      continue
    }
    if (s.level === 'error') scenario_script_errors.push(line)
    else scenario_script_logs.push(line)
  }

  // Also surface any ws-error entries that showed up in bot client logs.
  for (const log of artifact.logs) {
    if (isWebsocketError(log.message)) {
      websocket_errors.push({ time: log.time, level: log.level, message: log.message })
    }
  }

  websocket_errors.sort((a, b) => a.time - b.time)

  const success =
    artifact.terminated_by === 'scenario' &&
    artifact.exit_code === 0 &&
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
