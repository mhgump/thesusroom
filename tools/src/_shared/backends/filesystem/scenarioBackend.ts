import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTENT_DIR, SCENARIO_RUNS_DIR } from '../../paths.js'
import type { ScenarioBackend } from '../index.js'
import type { ScenarioKey, TsSource } from '../types.js'
import type { ScenarioSpec } from '../../../../../react-three-capacitor/server/src/ContentRegistry.js'

const SCENARIOS_DIR = path.join(CONTENT_DIR, 'scenarios')
const BOTS_DIR = path.join(CONTENT_DIR, 'bots')
const SCENARIO_MAP_PATH = path.join(CONTENT_DIR, 'scenario_map.json')

export class FilesystemScenarioBackend implements ScenarioBackend {
  private scenarioDir(key: ScenarioKey): string {
    return path.join(SCENARIOS_DIR, key)
  }

  private filePath(key: ScenarioKey): string {
    return path.join(this.scenarioDir(key), 'scenario.ts')
  }

  async get(key: ScenarioKey): Promise<TsSource | null> {
    try {
      const source = await fs.readFile(this.filePath(key), 'utf8')
      return { source }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async put(key: ScenarioKey, value: TsSource): Promise<void> {
    const abs = this.filePath(key)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, value.source)
  }

  async delete(key: ScenarioKey): Promise<void> {
    await this.deleteScenario(key)
  }

  async list(): Promise<{ key: ScenarioKey; value: TsSource }[]> {
    const names = await this.listIndex()
    const out: { key: ScenarioKey; value: TsSource }[] = []
    for (const name of names) {
      try {
        const source = await fs.readFile(this.filePath(name), 'utf8')
        out.push({ key: name, value: { source } })
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw err
      }
    }
    return out
  }

  locate(key: ScenarioKey): string | null {
    return this.filePath(key)
  }

  async listIndex(): Promise<string[]> {
    return readScenarioMap()
  }

  async load(key: ScenarioKey): Promise<ScenarioSpec | null> {
    const abs = this.filePath(key)
    try {
      await fs.access(abs)
    } catch {
      return null
    }
    const mod = await import(pathToFileURL(abs).href) as Record<string, unknown>
    const spec = mod.SCENARIO
    if (!spec) throw new Error(`scenario "${key}" missing required \`export const SCENARIO\` at ${abs}`)
    return spec as ScenarioSpec
  }

  async newScenario(scenario_id: string): Promise<number> {
    const names = await readScenarioMap()
    const existing = names.indexOf(scenario_id)
    if (existing !== -1) return existing
    names.push(scenario_id)
    await writeScenarioMap(names)
    await fs.mkdir(this.scenarioDir(scenario_id), { recursive: true })
    await ensureTestSpecsIndex(scenario_id)
    return names.length - 1
  }

  async deleteScenario(scenario_id: string): Promise<void> {
    const names = await readScenarioMap()
    const idx = names.indexOf(scenario_id)
    if (idx !== -1) {
      names.splice(idx, 1)
      await writeScenarioMap(names)
    }
    await rmDir(this.scenarioDir(scenario_id))
    await rmDir(path.join(BOTS_DIR, scenario_id))
    await rmDir(path.join(SCENARIO_RUNS_DIR, scenario_id))
  }
}

async function readScenarioMap(): Promise<string[]> {
  try {
    const raw = await fs.readFile(SCENARIO_MAP_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('scenario_map.json must be an array')
    return parsed.filter((n): n is string => typeof n === 'string')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

async function writeScenarioMap(names: string[]): Promise<void> {
  await fs.mkdir(path.dirname(SCENARIO_MAP_PATH), { recursive: true })
  await fs.writeFile(SCENARIO_MAP_PATH, JSON.stringify(names, null, 2) + '\n')
}

async function ensureTestSpecsIndex(scenario_id: string): Promise<void> {
  const p = path.join(SCENARIOS_DIR, scenario_id, 'test_specs.json')
  try {
    await fs.access(p)
  } catch {
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, '[]\n')
  }
}

async function rmDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
}
