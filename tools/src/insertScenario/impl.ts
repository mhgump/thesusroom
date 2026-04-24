import type { Tool } from '../framework.js'
import { getDataBackend } from '../_shared/backends/index.js'
import { validateWrittenFile } from '../_shared/validate.js'
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
  const data = getDataBackend()
  const { map, scenario } = data

  if ((await map.get(input.map_id)) === null) {
    const mapLoc = map.locate?.(input.map_id) ?? input.map_id
    return { success: false, error: `map "${input.map_id}" not found at ${mapLoc}` }
  }

  const scenario_index = await data.addScenario(input.scenario_id)
  await scenario.put(input.scenario_id, { source: input.file_content })

  const abs = scenario.locate?.(input.scenario_id)
  if (!abs) {
    throw new Error('backend does not support locate() — validation requires filesystem access')
  }
  const validation = await validateWrittenFile(abs, input.export_name, 'scenario')
  if (!validation.success) return validation
  return { success: true, scenario_index }
}

export const INSERT_SCENARIO_TOOL: Tool<InsertScenarioInput, InsertScenarioOutput> = {
  spec: INSERT_SCENARIO_SPEC,
  run: run as (input: InsertScenarioInput) => Promise<InsertScenarioOutput>,
}
