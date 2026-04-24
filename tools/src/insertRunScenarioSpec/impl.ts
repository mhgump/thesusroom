import fs from 'node:fs'
import path from 'node:path'
import type { Tool } from '../framework.js'
import { getDataBackend } from '../_shared/backends/index.js'
import { PROJECT_ROOT } from '../_shared/paths.js'
import type { RunScenarioSpec, RunScenarioSpecNote } from '../_shared/runScenarioSpec.js'
import {
  INSERT_RUN_SCENARIO_SPEC_SPEC,
  type InsertRunScenarioSpecInput,
  type InsertRunScenarioSpecOutput,
} from './spec.js'

const SLUG_RE = /^[a-zA-Z0-9_-]+$/

function validateInput(input: unknown): InsertRunScenarioSpecInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<InsertRunScenarioSpecInput>
  if (typeof i.name !== 'string' || !i.name) throw new Error('name must be a non-empty string')
  if (!SLUG_RE.test(i.name)) throw new Error('name must match [a-zA-Z0-9_-]+')
  if (typeof i.scenario_id !== 'string' || !i.scenario_id) throw new Error('scenario_id must be a non-empty string')
  if (!SLUG_RE.test(i.scenario_id)) throw new Error('scenario_id must match [a-zA-Z0-9_-]+')
  if (typeof i.map_id !== 'string' || !i.map_id) throw new Error('map_id must be a non-empty string')
  if (!SLUG_RE.test(i.map_id)) throw new Error('map_id must match [a-zA-Z0-9_-]+')
  if (!Array.isArray(i.bots) || i.bots.length === 0) throw new Error('bots must be a non-empty array')
  for (const [idx, b] of i.bots.entries()) {
    if (!b || typeof b !== 'object') throw new Error(`bots[${idx}] must be an object`)
    if (typeof b.path !== 'string' || !b.path) throw new Error(`bots[${idx}].path must be a non-empty string`)
    if (typeof b.export !== 'string' || !b.export) throw new Error(`bots[${idx}].export must be a non-empty string`)
  }
  if (i.opts !== undefined) {
    if (!i.opts || typeof i.opts !== 'object') throw new Error('opts must be an object')
  }
  if (i.notes !== undefined) {
    if (!Array.isArray(i.notes)) throw new Error('notes must be an array')
    for (const [idx, n] of i.notes.entries()) {
      if (!n || typeof n !== 'object') throw new Error(`notes[${idx}] must be an object`)
      if (typeof n.author !== 'string' || !n.author) throw new Error(`notes[${idx}].author must be a non-empty string`)
      if (typeof n.text !== 'string') throw new Error(`notes[${idx}].text must be a string`)
    }
  }
  return i as InsertRunScenarioSpecInput
}

async function run(rawInput: unknown): Promise<InsertRunScenarioSpecOutput> {
  let input: InsertRunScenarioSpecInput
  try {
    input = validateInput(rawInput)
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }

  const data = getDataBackend()
  const { map, scenario, testSpec } = data

  if ((await map.get(input.map_id)) === null) {
    const mapLoc = map.locate?.(input.map_id) ?? input.map_id
    return { success: false, error: `map "${input.map_id}" not found at ${mapLoc}` }
  }
  if ((await scenario.get(input.scenario_id)) === null) {
    const scenarioLoc = scenario.locate?.(input.scenario_id) ?? input.scenario_id
    return { success: false, error: `scenario "${input.scenario_id}" not found at ${scenarioLoc}` }
  }
  // Bot references in RunScenarioSpec use repo-root-relative filesystem paths,
  // not bot-backend keys. We are NOT reshaping that contract in this change, so
  // existence is still checked via fs.
  for (const [idx, b] of input.bots.entries()) {
    const abs = path.join(PROJECT_ROOT, b.path)
    if (!fs.existsSync(abs)) {
      return { success: false, error: `bots[${idx}].path does not exist: ${b.path}` }
    }
  }

  const opts = input.opts ?? {}
  if (opts.record_video_bot_index !== undefined) {
    if (!Number.isInteger(opts.record_video_bot_index) || opts.record_video_bot_index < 0
      || opts.record_video_bot_index >= input.bots.length) {
      return {
        success: false,
        error: `opts.record_video_bot_index must be an integer in [0, ${input.bots.length})`,
      }
    }
  }
  if (opts.collect_log_bot_indices !== undefined) {
    if (!Array.isArray(opts.collect_log_bot_indices)) {
      return { success: false, error: 'opts.collect_log_bot_indices must be an array of integers' }
    }
    for (const v of opts.collect_log_bot_indices) {
      if (!Number.isInteger(v) || v < 0 || v >= input.bots.length) {
        return {
          success: false,
          error: `opts.collect_log_bot_indices must all be integers in [0, ${input.bots.length})`,
        }
      }
    }
  }
  if (opts.timeout_ms !== undefined) {
    if (!Number.isInteger(opts.timeout_ms) || opts.timeout_ms <= 0) {
      return { success: false, error: 'opts.timeout_ms must be a positive integer' }
    }
  }

  const now = Date.now()
  const notes: RunScenarioSpecNote[] = (input.notes ?? []).map(n => ({
    time: now,
    author: n.author,
    text: n.text,
  }))

  const spec: RunScenarioSpec = {
    name: input.name,
    scenario_id: input.scenario_id,
    map_id: input.map_id,
    bots: input.bots.map(b => ({ path: b.path, export: b.export })),
    opts,
    notes,
    last_run_artifact_ids: [],
  }

  await data.addTestSpec(input.scenario_id, input.name)
  await testSpec.put({ scenario_id: input.scenario_id, test_spec_id: input.name }, spec)

  return { success: true, test_spec_name: input.name }
}

export const INSERT_RUN_SCENARIO_SPEC_TOOL: Tool<
  InsertRunScenarioSpecInput,
  InsertRunScenarioSpecOutput
> = {
  spec: INSERT_RUN_SCENARIO_SPEC_SPEC,
  run: run as (input: InsertRunScenarioSpecInput) => Promise<InsertRunScenarioSpecOutput>,
}
