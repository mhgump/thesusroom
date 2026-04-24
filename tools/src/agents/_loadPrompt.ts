import fs from 'node:fs'
import path from 'node:path'
import { PROMPTS_DIR } from '../_shared/paths.js'

export function loadPrompt(filename: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, filename), 'utf8')
}
