import fs from 'node:fs/promises'
import path from 'node:path'
import { CONTENT_DIR } from '../../paths.js'
import type { DataBackend } from '../dataBackend.js'

// Keys are written as `{CONTENT_DIR}/{key}.json`. Directory structure in the
// key path is preserved (e.g., `scenarios/foo/test_specs` → a nested file).
export class FilesystemDataBackend implements DataBackend {
  async readList<T>(key: string): Promise<T[]> {
    const value = await readJsonFile(resolve(key))
    if (value === null) return []
    if (!Array.isArray(value)) {
      throw new Error(`${resolve(key)} is not a JSON array`)
    }
    return value as T[]
  }

  writeList<T>(key: string, items: T[]): Promise<void> {
    return writeJsonFile(resolve(key), items)
  }

  async appendToList<T>(key: string, item: T): Promise<number> {
    const list = await this.readList<T>(key)
    list.push(item)
    await this.writeList(key, list)
    return list.length - 1
  }

  async removeFromList<T>(key: string, item: T): Promise<void> {
    const list = await this.readList<T>(key)
    const idx = indexOfByValue(list, item)
    if (idx === -1) return
    list.splice(idx, 1)
    await this.writeList(key, list)
  }

  async listCount(key: string): Promise<number> {
    const list = await this.readList(key)
    return list.length
  }

  async listIndexOf<T>(key: string, item: T): Promise<number> {
    const list = await this.readList<T>(key)
    return indexOfByValue(list, item)
  }

  async readJson<T>(key: string): Promise<T | null> {
    return (await readJsonFile(resolve(key))) as T | null
  }

  writeJson<T>(key: string, value: T): Promise<void> {
    return writeJsonFile(resolve(key), value)
  }

  async deleteJson(key: string): Promise<void> {
    try {
      await fs.rm(resolve(key), { force: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
  }
}

function resolve(key: string): string {
  return path.join(CONTENT_DIR, `${key}.json`)
}

async function readJsonFile(p: string): Promise<unknown> {
  try {
    const raw = await fs.readFile(p, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

async function writeJsonFile(p: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(value, null, 2) + '\n')
}

// Structural equality via JSON.stringify. Works for primitives and plain
// objects (both of which are all the domain classes hand to these ops).
function indexOfByValue<T>(list: T[], item: T): number {
  const target = JSON.stringify(item)
  return list.findIndex(x => JSON.stringify(x) === target)
}
