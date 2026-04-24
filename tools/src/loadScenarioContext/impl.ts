import fs from 'node:fs'
import path from 'node:path'
import type { Tool } from '../framework.js'
import { CONTENT_DIR, PROJECT_ROOT } from '../_shared/paths.js'
import type { RunScenarioSpec } from '../_shared/runScenarioSpec.js'
import {
  LOAD_SCENARIO_CONTEXT_SPEC,
  type LoadScenarioContextInput,
  type LoadScenarioContextOutput,
  type LoadedBot,
  type LoadedTestSpec,
} from './spec.js'

const SLUG_RE = /^[a-zA-Z0-9_-]+$/

function validateInput(input: unknown): LoadScenarioContextInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<LoadScenarioContextInput>
  if (typeof i.scenario_id !== 'string' || !i.scenario_id) {
    throw new Error('scenario_id must be a non-empty string')
  }
  if (!SLUG_RE.test(i.scenario_id)) {
    throw new Error('scenario_id must match [a-zA-Z0-9_-]+')
  }
  return i as LoadScenarioContextInput
}

function rel(abs: string): string {
  return path.relative(PROJECT_ROOT, abs).split(path.sep).join('/')
}

function readIfExists(abs: string): string | null {
  try { return fs.readFileSync(abs, 'utf8') } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

async function run(rawInput: unknown): Promise<LoadScenarioContextOutput> {
  const { scenario_id } = validateInput(rawInput)

  const planPath = path.join(CONTENT_DIR, 'scenario_plans', `${scenario_id}.json`)
  const mapPath = path.join(CONTENT_DIR, 'maps', scenario_id, 'map.ts')
  const scenarioPath = path.join(CONTENT_DIR, 'scenarios', scenario_id, 'scenario.ts')
  const botsDir = path.join(CONTENT_DIR, 'bots', scenario_id)
  const testSpecsDir = path.join(CONTENT_DIR, 'scenarios', scenario_id, 'test_specs')

  const planSource = readIfExists(planPath)
  const plan = planSource !== null
    ? { path: rel(planPath), json: JSON.parse(planSource) as unknown }
    : null

  const mapSource = readIfExists(mapPath)
  const map = mapSource !== null
    ? { path: rel(mapPath), source: mapSource }
    : null

  const scenarioSource = readIfExists(scenarioPath)
  const scenario = scenarioSource !== null
    ? { path: rel(scenarioPath), source: scenarioSource }
    : null

  const bots: LoadedBot[] = []
  if (fs.existsSync(botsDir)) {
    const entries = fs.readdirSync(botsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const botFile = path.join(botsDir, entry.name, 'bot.ts')
      const source = readIfExists(botFile)
      if (source === null) continue
      bots.push({ bot_id: entry.name, path: rel(botFile), source })
    }
    bots.sort((a, b) => a.bot_id.localeCompare(b.bot_id))
  }

  const testSpecs: LoadedTestSpec[] = []
  if (fs.existsSync(testSpecsDir)) {
    const entries = fs.readdirSync(testSpecsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const specFile = path.join(testSpecsDir, entry.name, 'spec.json')
      const raw = readIfExists(specFile)
      if (raw === null) continue
      testSpecs.push({
        name: entry.name,
        path: rel(specFile),
        spec: JSON.parse(raw) as RunScenarioSpec,
      })
    }
    testSpecs.sort((a, b) => a.name.localeCompare(b.name))
  }

  return {
    scenario_id,
    exists: {
      plan: plan !== null,
      map: map !== null,
      scenario: scenario !== null,
      bot_count: bots.length,
      test_spec_count: testSpecs.length,
    },
    plan,
    map,
    scenario,
    bots,
    test_specs: testSpecs,
  }
}

export const LOAD_SCENARIO_CONTEXT_TOOL: Tool<
  LoadScenarioContextInput,
  LoadScenarioContextOutput
> = {
  spec: LOAD_SCENARIO_CONTEXT_SPEC,
  run: run as (input: LoadScenarioContextInput) => Promise<LoadScenarioContextOutput>,
}
