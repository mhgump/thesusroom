import type { Tool } from '../framework.js'
import { getBackends } from '../_shared/backends/index.js'
import { parseRunResultKey } from '../_shared/backends/types.js'
import { parseLogs } from '../_shared/logFormat.js'
import type { LogLine } from '../getScenarioLogs/index.js'
import {
  GET_BOT_LOGS_SPEC,
  type GetBotLogsInput,
  type GetBotLogsOutput,
} from './spec.js'

function validateInput(input: unknown): GetBotLogsInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<GetBotLogsInput>
  if (typeof i.run_artifact_id !== 'string' || !i.run_artifact_id) {
    throw new Error('run_artifact_id must be a non-empty string')
  }
  if (typeof i.bot_id !== 'number' || !Number.isInteger(i.bot_id) || i.bot_id < 0) {
    throw new Error('bot_id must be a non-negative integer')
  }
  return i as GetBotLogsInput
}

// Messages produced by executing the user-provided BotSpec callbacks.
// (See BotClient.log sites: only `nextCommand[phase] threw` originates from
// spec code today, but we also treat message-parse errors and future spec-
// related errors as bot-script events.)
function isBotScript(message: string): boolean {
  return /nextCommand\[|onInstructMap|onChoice|onOtherPlayerMove|onActiveVoteAssignmentChange|message parse error/.test(
    message,
  )
}

function isDisconnect(message: string): boolean {
  return /eliminated by server|disconnected \(code=/.test(message)
}

async function run(rawInput: unknown): Promise<GetBotLogsOutput> {
  const input = validateInput(rawInput)
  const key = parseRunResultKey(input.run_artifact_id)
  if (key === null) {
    return {
      client_logs: [
        { time: 0, level: 'error', message: `invalid run_artifact_id: ${input.run_artifact_id}` },
      ],
      disconnected: true,
      bot_script_logs: [],
    }
  }
  const { scenarioRunResult } = getBackends()
  const artifact = await scenarioRunResult.get(key)
  if (artifact === null) {
    return {
      client_logs: [
        { time: 0, level: 'error', message: `artifact not found: ${input.run_artifact_id}` },
      ],
      disconnected: true,
      bot_script_logs: [],
    }
  }

  const client_logs: LogLine[] = []
  const bot_script_logs: LogLine[] = []
  let disconnected = false

  // `dateMs` anchors the date for the time-of-day prefix. Using Date.now()
  // is fine: all entries share the same day-of-run and only relative order
  // matters downstream.
  const entries = parseLogs(artifact.logs, Date.now())
  for (const log of entries) {
    if (log.source !== 'cli-bot' || log.bot_index !== input.bot_id) continue
    const line: LogLine = { time: log.time, level: log.level, message: log.message }
    if (isBotScript(log.message)) {
      bot_script_logs.push(line)
    } else {
      client_logs.push(line)
    }
    if (isDisconnect(log.message)) disconnected = true
  }

  return { client_logs, disconnected, bot_script_logs }
}

export const GET_BOT_LOGS_TOOL: Tool<GetBotLogsInput, GetBotLogsOutput> = {
  spec: GET_BOT_LOGS_SPEC,
  run: run as (input: GetBotLogsInput) => Promise<GetBotLogsOutput>,
}
