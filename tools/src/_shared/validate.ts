import { spawn } from 'node:child_process'
import { PROJECT_ROOT } from './paths.js'

// Runs a small tsx child that dynamic-imports the given .ts module and checks
// that `exportName` has the duck-typed shape for `kind`. Output on stdout is
// the JSON `{ ok: boolean, error?: string }`.
//
// We isolate validation in a child process because:
//   1. The parent may be compiled JS; content/*.ts only loads under tsx.
//   2. A thrown import-time error should not crash the tool.

export type ValidationKind = 'map' | 'scenario' | 'bot'

const VALIDATOR_SNIPPETS: Record<ValidationKind, string> = {
  map: `
    if (!v || typeof v !== 'object') throw new Error('export is not an object')
    const m = v
    if (typeof m.id !== 'string' || !m.id) throw new Error('missing string id')
    if (!m.worldSpec || typeof m.worldSpec !== 'object') throw new Error('missing worldSpec')
    if (!(m.roomPositions instanceof Map)) throw new Error('roomPositions must be a Map')
    if (!m.cameraShapes || typeof m.cameraShapes !== 'object') throw new Error('missing cameraShapes')
    if (typeof m.getRoomAtPosition !== 'function') throw new Error('getRoomAtPosition must be a function')
    if (!m.walkable || !Array.isArray(m.walkable.rects)) throw new Error('missing walkable.rects')
    if (!m.gameSpec || typeof m.gameSpec !== 'object') throw new Error('missing gameSpec')
    if (!Array.isArray(m.npcs)) throw new Error('npcs must be an array')
  `,
  scenario: `
    if (!v || typeof v !== 'object') throw new Error('export is not an object')
    const s = v
    if (typeof s.id !== 'string' || !s.id) throw new Error('missing string id')
    if (typeof s.timeoutMs !== 'number' || !(s.timeoutMs > 0)) throw new Error('timeoutMs must be a positive number')
    if (!s.script || typeof s.script !== 'object') throw new Error('script must be a GameScript object')
    if (typeof s.script.initialState !== 'function') throw new Error('script.initialState must be a function')
    const initial = s.script.initialState()
    if (initial === undefined) throw new Error('script.initialState() returned undefined')
    if (s.script.handlers !== undefined && (s.script.handlers === null || typeof s.script.handlers !== 'object')) {
      throw new Error('script.handlers must be an object when present')
    }
  `,
  bot: `
    if (!v || typeof v !== 'object') throw new Error('export is not an object')
    const b = v
    if (!Array.isArray(b.phases) || b.phases.length === 0) throw new Error('phases must be a non-empty array')
    if (!b.initialState || typeof b.initialState !== 'object') throw new Error('missing initialState')
    if (typeof b.initialState.phase !== 'string') throw new Error('initialState.phase must be a string')
    for (const key of ['onInstructMap','onOtherPlayerMove','onActiveVoteAssignmentChange','nextCommand']) {
      if (!b[key] || typeof b[key] !== 'object') throw new Error('missing ' + key + ' map')
    }
    for (const phase of b.phases) {
      if (typeof b.nextCommand[phase] !== 'function') throw new Error('nextCommand missing handler for phase "' + phase + '"')
    }
  `,
}

function runValidator(absPath: string, exportName: string, kind: ValidationKind): Promise<{ ok: boolean; error?: string }> {
  const script = `
    (async () => {
      try {
        const mod = await import(${JSON.stringify('file://' + absPath)})
        if (!(${JSON.stringify(exportName)} in mod)) {
          console.log(JSON.stringify({ ok: false, error: 'export "' + ${JSON.stringify(exportName)} + '" not found in module' }))
          return
        }
        const v = mod[${JSON.stringify(exportName)}]
        ${VALIDATOR_SNIPPETS[kind]}
        console.log(JSON.stringify({ ok: true }))
      } catch (err) {
        console.log(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }))
      }
    })()
  `
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', '-e', script], {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', reject)
    child.on('close', code => {
      // Pick the last JSON line from stdout (tsx may emit diagnostics above it).
      const lines = stdout.trim().split('\n').filter(Boolean)
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim()
        if (line.startsWith('{')) {
          try {
            return resolve(JSON.parse(line) as { ok: boolean; error?: string })
          } catch {
            // try next
          }
        }
      }
      resolve({
        ok: false,
        error: `validator exited ${code} with unparseable output.\nstdout: ${stdout}\nstderr: ${stderr}`,
      })
    })
  })
}

// Dynamic-import the already-written module at `absPath` and shape-check the
// named export. Storage is a separate concern (done via a backend's put()); this
// helper only handles validation. On failure the underlying file is left in
// place so the caller can inspect it — but the tool returns { success: false }.
export async function validateWrittenFile(
  absPath: string,
  exportName: string,
  kind: ValidationKind,
): Promise<{ success: true } | { success: false; error: string }> {
  const result = await runValidator(absPath, exportName, kind)
  if (!result.ok) return { success: false, error: result.error ?? 'validation failed' }
  return { success: true }
}
