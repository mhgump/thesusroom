// Per-agent log directories with parent/child linking.
//
//   logs/
//     create-scenario/{uuid}/
//       manifest.json      parent + children + input + response + duration
//       stderr.log         verbose progress lines
//       transcript.jsonl   (only when the agent runs a model loop)
//     map-agent/{uuid}/
//     scenario-plan-agent/{uuid}/
//     ...
//
// Every agent runner wraps its body in `withRunLog(kind, input, fn)`, which
// creates a fresh `logs/{kind}/{uuid}/` directory, stores it in an
// AsyncLocalStorage, and finalizes the manifest when the body resolves or
// throws. Sub-agents (either direct calls like createScenarioAgent does, or
// tool-wrapped ones the direct-agent invokes) automatically pick up the
// enclosing log as their parent via als — no threading required.

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { PROJECT_ROOT } from './paths.js'

const LOGS_ROOT = path.join(PROJECT_ROOT, 'logs')

export interface RunLogChildRef {
  kind: string
  id: string
  dir: string
  started_at: number
}

export class RunLog {
  readonly kind: string
  readonly id: string
  readonly dir: string
  readonly startedAt: number
  readonly parent: RunLog | null
  private children: RunLogChildRef[] = []
  private stderrFd: number | null = null
  private manifestExtras: Record<string, unknown> = {}

  constructor(kind: string, parent: RunLog | null) {
    this.kind = kind
    this.id = randomUUID()
    this.startedAt = Date.now()
    this.parent = parent
    this.dir = path.join(LOGS_ROOT, kind, this.id)
    fs.mkdirSync(this.dir, { recursive: true })
    this.stderrFd = fs.openSync(path.join(this.dir, 'stderr.log'), 'a')
    this.writeManifest()
    if (parent) parent.recordChild(this)
  }

  private recordChild(child: RunLog): void {
    this.children.push({
      kind: child.kind,
      id: child.id,
      dir: path.relative(PROJECT_ROOT, child.dir),
      started_at: child.startedAt,
    })
    this.writeManifest()
  }

  appendStderr(line: string): void {
    if (this.stderrFd === null) return
    try {
      fs.writeSync(this.stderrFd, line.endsWith('\n') ? line : line + '\n')
    } catch {
      // fd may be closed on a late write after finalize — ignore.
    }
  }

  appendTranscript(entry: unknown): void {
    fs.appendFileSync(
      path.join(this.dir, 'transcript.jsonl'),
      JSON.stringify(entry) + '\n',
    )
  }

  setInput(input: unknown): void {
    this.manifestExtras.input = input
    this.writeManifest()
  }

  finalize(response: unknown, error: unknown = null): void {
    const endedAt = Date.now()
    this.manifestExtras.response = response
    this.manifestExtras.error = error ? ((error as Error).message ?? String(error)) : null
    this.manifestExtras.ended_at = endedAt
    this.manifestExtras.duration_ms = endedAt - this.startedAt
    this.writeManifest()
    if (this.stderrFd !== null) {
      try { fs.closeSync(this.stderrFd) } catch {}
      this.stderrFd = null
    }
  }

  writeManifest(): void {
    const manifest = {
      kind: this.kind,
      id: this.id,
      dir: path.relative(PROJECT_ROOT, this.dir),
      started_at: this.startedAt,
      parent: this.parent
        ? {
            kind: this.parent.kind,
            id: this.parent.id,
            dir: path.relative(PROJECT_ROOT, this.parent.dir),
          }
        : null,
      children: this.children,
      ...this.manifestExtras,
    }
    fs.writeFileSync(
      path.join(this.dir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    )
  }
}

const als = new AsyncLocalStorage<RunLog>()

export function getCurrentRunLog(): RunLog | null {
  return als.getStore() ?? null
}

export async function withRunLog<T>(
  kind: string,
  input: unknown,
  fn: (log: RunLog) => Promise<T>,
): Promise<T> {
  const parent = getCurrentRunLog()
  const log = new RunLog(kind, parent)
  log.setInput(input)
  return als.run(log, async () => {
    try {
      const result = await fn(log)
      log.finalize(result)
      return result
    } catch (err) {
      log.finalize(null, err)
      throw err
    }
  })
}
