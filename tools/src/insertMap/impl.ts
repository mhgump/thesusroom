import type { Tool } from '../framework.js'
import { getBackends } from '../_shared/backends/index.js'
import { validateWrittenFile } from '../_shared/validate.js'
import { INSERT_MAP_SPEC, type InsertMapInput, type InsertMapOutput } from './spec.js'

function validateInput(input: unknown): InsertMapInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<InsertMapInput>
  if (typeof i.map_id !== 'string' || !i.map_id) throw new Error('map_id must be a non-empty string')
  if (!/^[a-zA-Z0-9_-]+$/.test(i.map_id)) throw new Error('map_id must match [a-zA-Z0-9_-]+')
  if (typeof i.export_name !== 'string' || !i.export_name) throw new Error('export_name must be a non-empty string')
  if (i.export_name !== 'MAP') throw new Error('export_name must be "MAP" — the runtime loader only recognises mod.MAP')
  if (typeof i.file_content !== 'string' || !i.file_content) throw new Error('file_content must be a non-empty string')
  return i as InsertMapInput
}

async function run(rawInput: unknown): Promise<InsertMapOutput> {
  const input = validateInput(rawInput)
  const { map } = getBackends()

  await map.put(input.map_id, { source: input.file_content })

  const abs = map.locate?.(input.map_id)
  if (!abs) {
    throw new Error('backend does not support locate() — validation requires filesystem access')
  }
  return validateWrittenFile(abs, input.export_name, 'map')
}

export const INSERT_MAP_TOOL: Tool<InsertMapInput, InsertMapOutput> = {
  spec: INSERT_MAP_SPEC,
  run: run as (input: InsertMapInput) => Promise<InsertMapOutput>,
}
