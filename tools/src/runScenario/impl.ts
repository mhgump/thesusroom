import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDataBackend } from '../_shared/backends/index.js'
import { ADHOC_TEST_SPEC, formatRunResultKey } from '../_shared/backends/types.js'
import type { Tool } from '../framework.js'
import {
  RUN_SCENARIO_SPEC,
  type RunScenarioInput,
  type ScenarioRunResult,
} from './spec.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// tools/src/runScenario/impl.ts → repo root
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const SERVER_DIR = path.join(PROJECT_ROOT, 'react-three-capacitor', 'server')
const RUN_SCENARIO_SCRIPT = path.join(SERVER_DIR, 'scripts', 'run-scenario.ts')

function validateInput(input: unknown): RunScenarioInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<RunScenarioInput>
  if (typeof i.scenario_id !== 'string' || !i.scenario_id) {
    throw new Error('scenario_id must be a non-empty string')
  }
  if (!Array.isArray(i.bots) || i.bots.length === 0) {
    throw new Error('bots must be a non-empty array')
  }
  for (const [idx, b] of i.bots.entries()) {
    if (!b || typeof b !== 'object') throw new Error(`bots[${idx}] must be an object`)
    if (typeof b.path !== 'string' || typeof b.export !== 'string') {
      throw new Error(`bots[${idx}] must have string path + export`)
    }
  }
  if (i.record_video_bot_index !== undefined) {
    const v = i.record_video_bot_index
    if (!Number.isInteger(v) || v < 0 || v >= i.bots.length) {
      throw new Error(
        `record_video_bot_index must be an integer in [0, ${i.bots.length}) — got ${v}`,
      )
    }
  }
  if (i.collect_log_bot_indices !== undefined) {
    if (!Array.isArray(i.collect_log_bot_indices)) {
      throw new Error('collect_log_bot_indices must be an array of integers')
    }
    for (const v of i.collect_log_bot_indices) {
      if (!Number.isInteger(v) || v < 0 || v >= i.bots.length) {
        throw new Error(
          `collect_log_bot_indices contains ${v}; must be in [0, ${i.bots.length})`,
        )
      }
    }
  }
  if (i.timeout_ms !== undefined) {
    if (!Number.isInteger(i.timeout_ms) || i.timeout_ms < 1) {
      throw new Error('timeout_ms must be a positive integer')
    }
  }
  if (i.test_spec_name !== undefined) {
    if (typeof i.test_spec_name !== 'string' || !i.test_spec_name) {
      throw new Error('test_spec_name must be a non-empty string')
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(i.test_spec_name)) {
      throw new Error('test_spec_name must match [a-zA-Z0-9_-]+')
    }
  }
  return i as RunScenarioInput
}

async function runChild(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', RUN_SCENARIO_SCRIPT, ...args], {
      cwd: SERVER_DIR,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', reject)
    child.on('close', code => resolve({ code: code ?? 0, stdout, stderr }))
  })
}

async function run(rawInput: unknown): Promise<ScenarioRunResult> {
  const input = validateInput(rawInput)
  const { scenarioRunResult } = getDataBackend()

  const scenario = input.scenario_id
  const test_spec = input.test_spec_name ?? ADHOC_TEST_SPEC
  const index = await scenarioRunResult.nextIndex(scenario, test_spec)
  const key = { scenario, test_spec, index }
  const runId = formatRunResultKey(key)

  // The child writes to a staging dir on disk (regardless of backend) so
  // playwright/ffmpeg have somewhere to drop video/screenshot. For the
  // filesystem backend this happens to be the backend's canonical location
  // — harmless overlap. For non-filesystem backends it's a temp area the
  // tool reads from before persisting via put().
  const outputDir = scenarioRunResult.locate?.(key)
    ?? path.join(PROJECT_ROOT, 'data', 'scenario_runs_tmp', scenario, test_spec, String(index))
  fs.mkdirSync(outputDir, { recursive: true })

  const botArgs = input.bots.flatMap(b => ['--bots', `${b.path}:${b.export}`])
  const cliArgs: string[] = [
    '--run-id', runId,
    '--scenario', scenario,
    '--test-spec-name', test_spec,
    '--run-index', String(index),
    ...botArgs,
    '--output-dir', outputDir,
    '--response-json', path.join(outputDir, 'response.json'),
  ]

  if (input.record_video_bot_index !== undefined) {
    cliArgs.push('--record-bot-index', String(input.record_video_bot_index))
  }
  if (input.collect_log_bot_indices !== undefined) {
    cliArgs.push('--log-bot-indices', input.collect_log_bot_indices.join(','))
  }
  if (input.timeout_ms !== undefined) {
    cliArgs.push('--timeout', String(input.timeout_ms))
  }

  const { code, stdout, stderr } = await runChild(cliArgs)

  const responsePath = path.join(outputDir, 'response.json')
  if (!fs.existsSync(responsePath)) {
    const detail = [stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)'
    throw new Error(
      `run-scenario.ts exited ${code} without producing ${responsePath}.\n${detail}`,
    )
  }
  const result = JSON.parse(fs.readFileSync(responsePath, 'utf8')) as ScenarioRunResult

  await scenarioRunResult.put(key, result)

  return result
}

export const RUN_SCENARIO_TOOL: Tool<RunScenarioInput, ScenarioRunResult> = {
  spec: RUN_SCENARIO_SPEC,
  run: run as (input: RunScenarioInput) => Promise<ScenarioRunResult>,
}
