// Shared text log format used by run-scenario.ts (writer) and tool readers.
//
// One entry per line:
//   [HH:mm:ss.SSS] [<source>#<bot_index>] <LEVEL> <message>   (bot lines)
//   [HH:mm:ss.SSS] [server] <LEVEL> <message>                 (server lines)
//
// Messages containing newlines are escaped to "\\n" on write and restored on
// read so the block remains line-addressable.
//
// Duplicated at react-three-capacitor/server/scripts/logFormat.ts so the
// script need not cross the package boundary — the format is the contract.

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

function unescapeMessage(msg: string): string {
  let out = ''
  for (let i = 0; i < msg.length; i++) {
    const c = msg[i]
    if (c === '\\' && i + 1 < msg.length) {
      const n = msg[i + 1]
      if (n === 'n') { out += '\n'; i++; continue }
      if (n === '\\') { out += '\\'; i++; continue }
    }
    out += c
  }
  return out
}

export function formatLogLine(e: LogEntry): string {
  const srcTag = e.bot_index === null ? `[${e.source}]` : `[${e.source}#${e.bot_index}]`
  return `[${ts(e.time)}] ${srcTag} ${e.level.toUpperCase()} ${escapeMessage(e.message)}`
}

export function formatLogs(entries: LogEntry[]): string {
  return entries.map(formatLogLine).join('\n')
}

const LINE_RE = /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\] \[([^\]]+)\] (INFO|WARN|ERROR) (.*)$/

// Parse one line back to a LogEntry. `dateMs` gives the absolute date from
// which to recover `time` (the prefix carries only time-of-day); typically the
// run start time. Returns null on prefix mismatch.
export function parseLogLine(line: string, dateMs: number): LogEntry | null {
  const m = LINE_RE.exec(line)
  if (!m) return null
  const [, h, min, sec, ms, srcTag, levelStr, rawMsg] = m

  let source: LogSource
  let bot_index: number | null
  const hashIdx = srcTag.indexOf('#')
  if (hashIdx === -1) {
    if (srcTag !== 'server') return null
    source = 'server'
    bot_index = null
  } else {
    const s = srcTag.slice(0, hashIdx)
    if (s !== 'cli-bot' && s !== 'scenario-bot') return null
    source = s
    const idx = parseInt(srcTag.slice(hashIdx + 1), 10)
    if (!Number.isInteger(idx) || idx < 0) return null
    bot_index = idx
  }

  const tod = (+h * 3600 + +min * 60 + +sec) * 1000 + +ms
  const day = Math.floor(dateMs / 86_400_000) * 86_400_000
  return {
    time: day + tod,
    level: levelStr.toLowerCase() as LogLevel,
    source,
    bot_index,
    message: unescapeMessage(rawMsg),
  }
}

export function parseLogs(text: string, dateMs: number): LogEntry[] {
  if (!text) return []
  const out: LogEntry[] = []
  for (const line of text.split('\n')) {
    if (!line) continue
    const e = parseLogLine(line, dateMs)
    if (e) out.push(e)
  }
  return out
}
