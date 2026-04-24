import fs from 'node:fs'
import path from 'node:path'
import type { Tool } from '../framework.js'
import { CONTENT_DIR } from '../_shared/paths.js'
import { writeAndValidate } from '../_shared/validate.js'
import {
  INSERT_SCENARIO_SPEC,
  type InsertScenarioInput,
  type InsertScenarioOutput,
} from './spec.js'

function validateInput(input: unknown): InsertScenarioInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<InsertScenarioInput>
  if (typeof i.scenario_id !== 'string' || !i.scenario_id) throw new Error('scenario_id must be a non-empty string')
  if (!/^[a-zA-Z0-9_-]+$/.test(i.scenario_id)) throw new Error('scenario_id must match [a-zA-Z0-9_-]+')
  if (typeof i.map_id !== 'string' || !i.map_id) throw new Error('map_id must be a non-empty string')
  if (!/^[a-zA-Z0-9_-]+$/.test(i.map_id)) throw new Error('map_id must match [a-zA-Z0-9_-]+')
  if (typeof i.export_name !== 'string' || !i.export_name) throw new Error('export_name must be a non-empty string')
  if (typeof i.file_content !== 'string' || !i.file_content) throw new Error('file_content must be a non-empty string')
  return i as InsertScenarioInput
}

async function run(rawInput: unknown): Promise<InsertScenarioOutput> {
  const input = validateInput(rawInput)
  const mapPath = path.join(CONTENT_DIR, 'maps', `${input.map_id}.ts`)
  if (!fs.existsSync(mapPath)) {
    return { success: false, error: `map "${input.map_id}" not found at ${mapPath}` }
  }
  const absPath = path.join(CONTENT_DIR, 'scenarios', `${input.scenario_id}.ts`)
  return writeAndValidate(absPath, input.file_content, input.export_name, 'scenario')
}

export const INSERT_SCENARIO_TOOL: Tool<InsertScenarioInput, InsertScenarioOutput> = {
  spec: INSERT_SCENARIO_SPEC,
  run: run as (input: InsertScenarioInput) => Promise<InsertScenarioOutput>,
}
