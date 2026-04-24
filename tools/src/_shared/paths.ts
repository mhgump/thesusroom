import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// tools/src/_shared/paths.ts → repo root
export const PROJECT_ROOT = path.resolve(__dirname, '../../..')
export const CONTENT_DIR = path.join(PROJECT_ROOT, 'content')
export const SCENARIOS_DIR = path.join(CONTENT_DIR, 'scenarios')
export const SCENARIO_RUNS_DIR = path.join(CONTENT_DIR, 'scenario_runs')
export const PROMPTS_DIR = path.join(PROJECT_ROOT, 'prompts')
