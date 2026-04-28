import type { Tool } from '../framework.js'
import { getBackends } from '../../../shared/backends/index.js'
import { validateWrittenFile } from '../../../shared/validate.js'
import { INSERT_BOT_SPEC, type InsertBotInput, type InsertBotOutput } from './spec.js'

function validateInput(input: unknown): InsertBotInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<InsertBotInput>
  if (typeof i.bot_id !== 'string' || !i.bot_id) throw new Error('bot_id must be a non-empty string')
  if (!/^[a-zA-Z0-9_-]+$/.test(i.bot_id)) throw new Error('bot_id must match [a-zA-Z0-9_-]+')
  if (typeof i.scenario_id !== 'string' || !i.scenario_id) throw new Error('scenario_id must be a non-empty string')
  if (!/^[a-zA-Z0-9_-]+$/.test(i.scenario_id)) throw new Error('scenario_id must match [a-zA-Z0-9_-]+')
  if (typeof i.export_name !== 'string' || !i.export_name) throw new Error('export_name must be a non-empty string')
  if (typeof i.file_content !== 'string' || !i.file_content) throw new Error('file_content must be a non-empty string')
  return i as InsertBotInput
}

async function run(rawInput: unknown): Promise<InsertBotOutput> {
  const input = validateInput(rawInput)
  const { bot } = getBackends()

  // Bots are content files scoped to a scenario slug, but the scenario file
  // itself need not exist yet. The create-scenario orchestrator authors bots
  // BEFORE the scenario so the scenario's dynamic import can resolve the
  // bot (see create_scenario_prompt.md stage-2 ordering).

  const key = { scenario_id: input.scenario_id, bot_id: input.bot_id }
  await bot.put(key, { source: input.file_content })

  const abs = bot.locate?.(key)
  if (!abs) {
    throw new Error('backend does not support locate() — validation requires filesystem access')
  }
  return validateWrittenFile(abs, input.export_name, 'bot')
}

export const INSERT_BOT_TOOL: Tool<InsertBotInput, InsertBotOutput> = {
  spec: INSERT_BOT_SPEC,
  run: run as (input: InsertBotInput) => Promise<InsertBotOutput>,
}
