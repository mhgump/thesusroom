// Shared text log format used by run-scenario.ts (writer) and tool readers.
//
// One entry per line:
//   [HH:mm:ss.SSS] [<source>#<bot_index>] <LEVEL> <message>   (bot lines)
//   [HH:mm:ss.SSS] [server] <LEVEL> <message>                 (server lines)
//
// Messages containing newlines are escaped to "\\n" on write and restored on
// read so the block remains line-addressable.
//
// Duplicated at tools/src/_shared/logFormat.ts — the format is the contract.

export type LogLevel = 'info' | 'warn' | 'error'
export type LogSource = 'cli-bot' | 'scenario-bot' | 'server'

export interface LogEntry {
  time: number
  level: LogLevel
  source: LogSource
  bot_index: number | null
  message: string
}

function ts(time: number): string {
  return new Date(time).toISOString().slice(11, 23)
}

function escapeMessage(msg: string): string {
  return msg.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
}

export function formatLogLine(e: LogEntry): string {
  const srcTag = e.bot_index === null ? `[${e.source}]` : `[${e.source}#${e.bot_index}]`
  return `[${ts(e.time)}] ${srcTag} ${e.level.toUpperCase()} ${escapeMessage(e.message)}`
}

export function formatLogs(entries: LogEntry[]): string {
  return entries.map(formatLogLine).join('\n')
}
