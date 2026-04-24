import type { LogEntry } from '../../scripts/logFormat.js'

// Process-wide console tee. The scenario-run registry installs this once on
// first use so GET /scenario-run/:id/result can hand back the server-side
// console output that overlapped with the run. Entries are assigned a
// monotonic seq so each run can snapshot [start, end) by index without
// racing the ring buffer.

interface TeeEntry {
  seq: number
  time: number
  level: 'info' | 'warn' | 'error'
  message: string
}

const MAX_ENTRIES = 10_000
const ring: TeeEntry[] = []
let nextSeq = 0
let installed = false

function stringify(args: unknown[]): string {
  return args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
}

export function installConsoleTee(): void {
  if (installed) return
  installed = true
  const origLog = console.log.bind(console)
  const origWarn = console.warn.bind(console)
  const origErr = console.error.bind(console)
  const push = (level: TeeEntry['level'], message: string): void => {
    ring.push({ seq: nextSeq++, time: Date.now(), level, message })
    if (ring.length > MAX_ENTRIES) ring.splice(0, ring.length - MAX_ENTRIES)
  }
  console.log = (...args: unknown[]) => { push('info', stringify(args)); origLog(...args) }
  console.warn = (...args: unknown[]) => { push('warn', stringify(args)); origWarn(...args) }
  console.error = (...args: unknown[]) => { push('error', stringify(args)); origErr(...args) }
}

// Returns the current high-water seq. Callers snapshot this on run start and
// again on run end, then call `sliceByRange` to get the entries in that window.
export function currentSeq(): number {
  return nextSeq
}

export function sliceByRange(startSeq: number, endSeq: number): LogEntry[] {
  const out: LogEntry[] = []
  for (const e of ring) {
    if (e.seq < startSeq) continue
    if (e.seq >= endSeq) break
    out.push({
      time: e.time,
      level: e.level,
      source: 'server',
      bot_index: null,
      message: e.message,
    })
  }
  return out
}
