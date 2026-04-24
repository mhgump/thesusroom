import fs from 'node:fs/promises'
import path from 'node:path'
import { SCENARIO_RUNS_DIR } from '../../paths.js'
import type { DataBackend } from '../dataBackend.js'
import type { RunResultKey, ScenarioRunResult } from '../types.js'

// Filesystem layout:
//   content/scenario_runs/<scenario>/<test_spec>/<index>/response.json
//   content/scenario_runs/<scenario>/<test_spec>/<index>/<N>.mp4       (optional)
//   content/scenario_runs/<scenario>/<test_spec>/<index>/<N>-screenshot.png
export class FilesystemScenarioRunResultBackend
  implements DataBackend<RunResultKey, ScenarioRunResult>
{
  private runDir(key: RunResultKey): string {
    return path.join(SCENARIO_RUNS_DIR, key.scenario, key.test_spec, String(key.index))
  }

  private filePath(key: RunResultKey): string {
    return path.join(this.runDir(key), 'response.json')
  }

  async get(key: RunResultKey): Promise<ScenarioRunResult | null> {
    try {
      const raw = await fs.readFile(this.filePath(key), 'utf8')
      return JSON.parse(raw) as ScenarioRunResult
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async put(key: RunResultKey, value: ScenarioRunResult): Promise<void> {
    const abs = this.filePath(key)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, JSON.stringify(value, null, 2) + '\n')
  }

  async delete(key: RunResultKey): Promise<void> {
    try {
      await fs.rm(this.runDir(key), { recursive: true, force: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
  }

  async list(): Promise<{ key: RunResultKey; value: ScenarioRunResult }[]> {
    const out: { key: RunResultKey; value: ScenarioRunResult }[] = []
    const scenarios = await readdirSafe(SCENARIO_RUNS_DIR)
    for (const scenario of scenarios) {
      if (!scenario.isDirectory()) continue
      const scenarioDir = path.join(SCENARIO_RUNS_DIR, scenario.name)
      const testSpecs = await readdirSafe(scenarioDir)
      for (const testSpec of testSpecs) {
        if (!testSpec.isDirectory()) continue
        const testSpecDir = path.join(scenarioDir, testSpec.name)
        const indices = await readdirSafe(testSpecDir)
        for (const idxEntry of indices) {
          if (!idxEntry.isDirectory()) continue
          const index = Number(idxEntry.name)
          if (!Number.isInteger(index) || index < 0) continue
          const respPath = path.join(testSpecDir, idxEntry.name, 'response.json')
          try {
            const raw = await fs.readFile(respPath, 'utf8')
            const parsed = JSON.parse(raw) as ScenarioRunResult
            out.push({ key: { scenario: scenario.name, test_spec: testSpec.name, index }, value: parsed })
          } catch {
            continue
          }
        }
      }
    }
    return out
  }

  locate(key: RunResultKey): string | null {
    return this.runDir(key)
  }

  // Scan existing indices for (scenario, test_spec) and return the next free one.
  // Callers use this before put() to assign a fresh key.
  async nextIndex(scenario: string, test_spec: string): Promise<number> {
    const dir = path.join(SCENARIO_RUNS_DIR, scenario, test_spec)
    const entries = await readdirSafe(dir)
    let max = -1
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const i = Number(e.name)
      if (Number.isInteger(i) && i > max) max = i
    }
    return max + 1
  }
}

async function readdirSafe(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}
