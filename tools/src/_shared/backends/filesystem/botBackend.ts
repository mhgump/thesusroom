import fs from 'node:fs/promises'
import path from 'node:path'
import { CONTENT_DIR } from '../../paths.js'
import type { DataBackend } from '../dataBackend.js'
import type { BotKey, TsSource } from '../types.js'

const BOTS_DIR = path.join(CONTENT_DIR, 'bots')

export class FilesystemBotBackend implements DataBackend<BotKey, TsSource> {
  private botDir(key: BotKey): string {
    return path.join(BOTS_DIR, key.scenario_id, key.bot_id)
  }

  private filePath(key: BotKey): string {
    return path.join(this.botDir(key), 'bot.ts')
  }

  async get(key: BotKey): Promise<TsSource | null> {
    try {
      const source = await fs.readFile(this.filePath(key), 'utf8')
      return { source }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async put(key: BotKey, value: TsSource): Promise<void> {
    const abs = this.filePath(key)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, value.source)
  }

  async delete(key: BotKey): Promise<void> {
    try {
      await fs.rm(this.botDir(key), { recursive: true, force: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
  }

  async list(): Promise<{ key: BotKey; value: TsSource }[]> {
    const out: { key: BotKey; value: TsSource }[] = []
    let scenarioEntries: import('node:fs').Dirent[]
    try {
      scenarioEntries = await fs.readdir(BOTS_DIR, { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return out
      throw err
    }
    for (const scenarioEntry of scenarioEntries) {
      if (!scenarioEntry.isDirectory()) continue
      const scenario_id = scenarioEntry.name
      const scenarioDir = path.join(BOTS_DIR, scenario_id)
      const botEntries = await fs.readdir(scenarioDir, { withFileTypes: true })
      for (const botEntry of botEntries) {
        if (!botEntry.isDirectory()) continue
        const bot_id = botEntry.name
        try {
          const source = await fs.readFile(path.join(scenarioDir, bot_id, 'bot.ts'), 'utf8')
          out.push({ key: { scenario_id, bot_id }, value: { source } })
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw err
        }
      }
    }
    return out
  }

  locate(key: BotKey): string | null {
    return this.filePath(key)
  }
}
