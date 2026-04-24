import fs from 'node:fs'
import path from 'node:path'
import type { Tool } from '../framework.js'
import { CONTENT_DIR, PROJECT_ROOT, TEST_SPECS_DIR } from '../_shared/paths.js'
import type { RunScenarioSpec } from '../_shared/runScenarioSpec.js'
import {
  LIST_CONTENT_SPEC,
  type ListContentInput,
  type ListContentOutput,
  type ListedBot,
  type ListedMap,
  type ListedScenario,
  type ListedTestSpec,
} from './spec.js'

function validateInput(input: unknown): ListContentInput {
  if (input === null || input === undefined) return {}
  if (typeof input !== 'object') throw new Error('input must be an object')
  return input as ListContentInput
}

function compileRegex(pattern: string | undefined, field: string): RegExp {
  try {
    return new RegExp(pattern ?? '.*')
  } catch (err) {
    throw new Error(`invalid ${field} regex: ${(err as Error).message}`)
  }
}

function relPath(abs: string): string {
  return path.relative(PROJECT_ROOT, abs).split(path.sep).join('/')
}

function readDirSafe(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

async function run(rawInput: unknown): Promise<ListContentOutput> {
  const input = validateInput(rawInput)

  const scenarioRe = compileRegex(input.scenario_name_regex, 'scenario_name_regex')
  const mapRe = compileRegex(input.map_name_regex, 'map_name_regex')
  const botRe = compileRegex(input.bot_spec_name, 'bot_spec_name')
  const testSpecRe = compileRegex(input.test_spec_name_regex, 'test_spec_name_regex')

  const anyFor =
    input.for_scenarios === true ||
    input.for_maps === true ||
    input.for_bots === true ||
    input.for_test_specs === true

  const wantScenarios = !anyFor || input.for_scenarios === true
  const wantMaps = !anyFor || input.for_maps === true
  const wantBots = !anyFor || input.for_bots === true
  const wantTestSpecs = !anyFor || input.for_test_specs === true

  const scenarios: ListedScenario[] = []
  const maps: ListedMap[] = []
  const bots: ListedBot[] = []
  const testSpecs: ListedTestSpec[] = []

  if (wantScenarios) {
    const dir = path.join(CONTENT_DIR, 'scenarios')
    for (const entry of readDirSafe(dir)) {
      if (!entry.endsWith('.ts')) continue
      const slug = entry.slice(0, -3)
      if (!scenarioRe.test(slug)) continue
      scenarios.push({ name: slug, path: relPath(path.join(dir, entry)) })
    }
  }

  if (wantMaps) {
    const dir = path.join(CONTENT_DIR, 'maps')
    for (const entry of readDirSafe(dir)) {
      if (!entry.endsWith('.ts')) continue
      if (entry === 'index.ts') continue
      const slug = entry.slice(0, -3)
      if (!mapRe.test(slug)) continue
      maps.push({ name: slug, path: relPath(path.join(dir, entry)) })
    }
  }

  if (wantBots) {
    const botsRoot = path.join(CONTENT_DIR, 'bots')
    for (const scenarioDir of readDirSafe(botsRoot)) {
      const abs = path.join(botsRoot, scenarioDir)
      let stat: fs.Stats
      try {
        stat = fs.statSync(abs)
      } catch {
        continue
      }
      if (!stat.isDirectory()) continue
      for (const entry of readDirSafe(abs)) {
        if (!entry.endsWith('.ts')) continue
        const slug = entry.slice(0, -3)
        if (!botRe.test(slug)) continue
        bots.push({
          name: slug,
          scenario_id: scenarioDir,
          path: relPath(path.join(abs, entry)),
        })
      }
    }
  }

  if (wantTestSpecs) {
    for (const entry of readDirSafe(TEST_SPECS_DIR)) {
      if (!entry.endsWith('.json')) continue
      const slug = entry.slice(0, -5)
      if (!testSpecRe.test(slug)) continue
      const abs = path.join(TEST_SPECS_DIR, entry)
      let spec: RunScenarioSpec
      try {
        spec = JSON.parse(fs.readFileSync(abs, 'utf8')) as RunScenarioSpec
      } catch {
        continue
      }
      testSpecs.push({
        name: slug,
        path: relPath(abs),
        scenario_id: typeof spec.scenario_id === 'string' ? spec.scenario_id : '',
        map_id: typeof spec.map_id === 'string' ? spec.map_id : '',
        bot_count: Array.isArray(spec.bots) ? spec.bots.length : 0,
        note_count: Array.isArray(spec.notes) ? spec.notes.length : 0,
      })
    }
  }

  return { scenarios, maps, bots, test_specs: testSpecs }
}

export const LIST_CONTENT_TOOL: Tool<ListContentInput, ListContentOutput> = {
  spec: LIST_CONTENT_SPEC,
  run: run as (input: ListContentInput) => Promise<ListContentOutput>,
}
