import fs from 'node:fs/promises'
import path from 'node:path'
import { CONTENT_DIR } from '../../paths.js'
import type { DataBackend } from '../dataBackend.js'
import type { MapKey, TsSource } from '../types.js'

const MAPS_DIR = path.join(CONTENT_DIR, 'maps')

export class FilesystemMapBackend implements DataBackend<MapKey, TsSource> {
  private mapDir(key: MapKey): string {
    return path.join(MAPS_DIR, key)
  }

  private filePath(key: MapKey): string {
    return path.join(this.mapDir(key), 'map.ts')
  }

  async get(key: MapKey): Promise<TsSource | null> {
    try {
      const source = await fs.readFile(this.filePath(key), 'utf8')
      return { source }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async put(key: MapKey, value: TsSource): Promise<void> {
    const abs = this.filePath(key)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, value.source)
  }

  async delete(key: MapKey): Promise<void> {
    try {
      await fs.rm(this.mapDir(key), { recursive: true, force: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
  }

  async list(): Promise<{ key: MapKey; value: TsSource }[]> {
    const out: { key: MapKey; value: TsSource }[] = []
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(MAPS_DIR, { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return out
      throw err
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const map_id = entry.name
      try {
        const source = await fs.readFile(path.join(this.mapDir(map_id), 'map.ts'), 'utf8')
        out.push({ key: map_id, value: { source } })
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw err
      }
    }
    return out
  }

  locate(key: MapKey): string | null {
    return this.filePath(key)
  }
}
