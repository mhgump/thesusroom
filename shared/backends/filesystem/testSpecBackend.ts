import fs from 'node:fs/promises'
import path from 'node:path'
import { CONTENT_DIR, SCENARIO_RUNS_DIR } from '../../paths.js'
import type { RunScenarioSpec } from '../../runScenarioSpec.js'
import type { TestSpecBackend } from '../index.js'
import type { TestSpecKey } from '../types.js'

const SCENARIOS_DIR = path.join(CONTENT_DIR, 'scenarios')

export class FilesystemTestSpecBackend implements TestSpecBackend {
  private specDir(key: TestSpecKey): string {
    return path.join(SCENARIOS_DIR, key.scenario_id, 'test_specs', key.test_spec_id)
  }

  private filePath(key: TestSpecKey): string {
    return path.join(this.specDir(key), 'spec.json')
  }

  private indexPath(scenario_id: string): string {
    return path.join(SCENARIOS_DIR, scenario_id, 'test_specs.json')
  }

  async get(key: TestSpecKey): Promise<RunScenarioSpec | null> {
    try {
      const raw = await fs.readFile(this.filePath(key), 'utf8')
      return JSON.parse(raw) as RunScenarioSpec
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async put(key: TestSpecKey, value: RunScenarioSpec): Promise<void> {
    const abs = this.filePath(key)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, JSON.stringify(value, null, 2) + '\n')
  }

  async delete(key: TestSpecKey): Promise<void> {
    await this.deleteTestSpec(key.scenario_id, key.test_spec_id)
  }

  async list(): Promise<{ key: TestSpecKey; value: RunScenarioSpec }[]> {
    const out: { key: TestSpecKey; value: RunScenarioSpec }[] = []
    let scenarioEntries: import('node:fs').Dirent[]
    try {
      scenarioEntries = await fs.readdir(SCENARIOS_DIR, { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return out
      throw err
    }
    for (const scenarioEntry of scenarioEntries) {
      if (!scenarioEntry.isDirectory()) continue
      const scenario_id = scenarioEntry.name
      const names = await this.listIndex(scenario_id)
      for (const test_spec_id of names) {
        const key: TestSpecKey = { scenario_id, test_spec_id }
        const value = await this.get(key)
        if (value !== null) out.push({ key, value })
      }
    }
    return out
  }

  locate(key: TestSpecKey): string | null {
    return this.filePath(key)
  }

  async listIndex(scenario_id: string): Promise<string[]> {
    return readIndex(this.indexPath(scenario_id))
  }

  async newTestSpec(scenario_id: string, test_spec_id: string): Promise<number> {
    const p = this.indexPath(scenario_id)
    await fs.mkdir(path.dirname(p), { recursive: true })
    const names = await readIndex(p)
    const existing = names.indexOf(test_spec_id)
    if (existing !== -1) return existing
    names.push(test_spec_id)
    await writeIndex(p, names)
    await fs.mkdir(this.specDir({ scenario_id, test_spec_id }), { recursive: true })
    return names.length - 1
  }

  async deleteTestSpec(scenario_id: string, test_spec_id: string): Promise<void> {
    const p = this.indexPath(scenario_id)
    const names = await readIndex(p)
    const idx = names.indexOf(test_spec_id)
    if (idx !== -1) {
      names.splice(idx, 1)
      await writeIndex(p, names)
    }
    await rmDir(this.specDir({ scenario_id, test_spec_id }))
    await rmDir(path.join(SCENARIO_RUNS_DIR, scenario_id, test_spec_id))
  }
}

async function readIndex(p: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(p, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error(`${p} must be a JSON array`)
    return parsed.filter((n): n is string => typeof n === 'string')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

async function writeIndex(p: string, names: string[]): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(names, null, 2) + '\n')
}

async function rmDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
}
