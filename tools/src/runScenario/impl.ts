import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Tool } from '../framework.js'
import {
  RUN_SCENARIO_SPEC,
  type RunScenarioInput,
  type RunScenarioOutput,
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

async function run(rawInput: unknown): Promise<RunScenarioOutput> {
  const input = validateInput(rawInput)

  const runId = randomUUID()
  const outputDir = path.join(PROJECT_ROOT, 'data', 'scenario_runs', runId)
  fs.mkdirSync(outputDir, { recursive: true })

  const botArgs = input.bots.flatMap(b => ['--bots', `${b.path}:${b.export}`])
  const cliArgs: string[] = [
    '--scenario', input.scenario_id,
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

  // The child writes response.json even on failure paths after the run completes;
  // if it's missing, surface the child's stderr to help the caller debug.
  const responsePath = path.join(outputDir, 'response.json')
  if (!fs.existsSync(responsePath)) {
    const detail = [stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)'
    throw new Error(
      `run-scenario.ts exited ${code} without producing ${responsePath}.\n${detail}`,
    )
  }

  const childResponse = JSON.parse(fs.readFileSync(responsePath, 'utf8')) as Omit<
    RunScenarioOutput,
    'run_id' | 'output_dir'
  >

  const response: RunScenarioOutput = {
    run_id: runId,
    output_dir: outputDir,
    ...childResponse,
  }

  // Rewrite response.json with the enriched fields so the on-disk duplicate
  // matches what's returned to the caller.
  fs.writeFileSync(responsePath, JSON.stringify(response, null, 2))

  return response
}

export const RUN_SCENARIO_TOOL: Tool<RunScenarioInput, RunScenarioOutput> = {
  spec: RUN_SCENARIO_SPEC,
  run: run as (input: RunScenarioInput) => Promise<RunScenarioOutput>,
}
