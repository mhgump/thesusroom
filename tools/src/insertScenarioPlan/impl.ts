import fs from 'node:fs'
import path from 'node:path'
import type { Tool } from '../framework.js'
import { CONTENT_DIR } from '../../../shared/paths.js'
import {
  INSERT_SCENARIO_PLAN_SPEC,
  type InsertScenarioPlanInput,
  type InsertScenarioPlanOutput,
} from './spec.js'

const SLUG_RE = /^[a-zA-Z0-9_-]+$/
const PLANS_DIR = path.join(CONTENT_DIR, 'scenario_plans')

function validateInput(input: unknown): InsertScenarioPlanInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<InsertScenarioPlanInput>

  if (typeof i.plan_id !== 'string' || !SLUG_RE.test(i.plan_id)) {
    throw new Error('plan_id must be a non-empty slug matching [a-zA-Z0-9_-]+')
  }
  for (const field of [
    'concept_description',
    'scenario_sketch',
    'possible_outcomes_description',
    'outcomes_test_plan',
  ] as const) {
    const v = i[field]
    if (typeof v !== 'string' || !v) throw new Error(`${field} must be a non-empty string`)
  }
  if (!Number.isInteger(i.min_player_count) || (i.min_player_count as number) < 1) {
    throw new Error('min_player_count must be an integer ≥ 1')
  }
  if (!Number.isInteger(i.max_player_count) || (i.max_player_count as number) < 1) {
    throw new Error('max_player_count must be an integer ≥ 1')
  }
  if (!Array.isArray(i.bot_personas) || i.bot_personas.length === 0) {
    throw new Error('bot_personas must be a non-empty array')
  }
  if (!Array.isArray(i.outcomes) || i.outcomes.length === 0) {
    throw new Error('outcomes must be a non-empty array')
  }
  return i as InsertScenarioPlanInput
}

function crossCheck(plan: InsertScenarioPlanInput): string | null {
  if (plan.min_player_count > plan.max_player_count) {
    return `min_player_count (${plan.min_player_count}) must be ≤ max_player_count (${plan.max_player_count})`
  }

  const personaNames = new Set<string>()
  for (const p of plan.bot_personas) {
    if (typeof p?.name !== 'string' || !p.name) return 'each bot_persona must have a non-empty name'
    if (typeof p.description !== 'string' || !p.description) {
      return `bot_persona "${p.name}" must have a non-empty description`
    }
    if (personaNames.has(p.name)) return `duplicate bot_persona name "${p.name}"`
    personaNames.add(p.name)
  }

  for (let i = 0; i < plan.outcomes.length; i++) {
    const o = plan.outcomes[i]
    if (!Array.isArray(o?.personas) || o.personas.length === 0) {
      return `outcomes[${i}].personas must be a non-empty array`
    }
    let totalCount = 0
    for (const p of o.personas) {
      if (!personaNames.has(p.name)) {
        return `outcomes[${i}] references unknown persona "${p.name}"`
      }
      if (!Number.isInteger(p.count) || p.count < 1) {
        return `outcomes[${i}] persona "${p.name}" count must be an integer ≥ 1`
      }
      totalCount += p.count
    }
    if (!Number.isInteger(o.expected_survivors) || o.expected_survivors < 0) {
      return `outcomes[${i}].expected_survivors must be an integer ≥ 0`
    }
    if (o.expected_survivors > totalCount) {
      return `outcomes[${i}].expected_survivors (${o.expected_survivors}) exceeds total personas (${totalCount})`
    }
    if (totalCount < plan.min_player_count || totalCount > plan.max_player_count) {
      return `outcomes[${i}] total personas (${totalCount}) outside [${plan.min_player_count}, ${plan.max_player_count}]`
    }
  }
  return null
}

async function run(rawInput: unknown): Promise<InsertScenarioPlanOutput> {
  const input = validateInput(rawInput)
  const err = crossCheck(input)
  if (err) return { success: false, error: err }

  await fs.promises.mkdir(PLANS_DIR, { recursive: true })
  const abs = path.join(PLANS_DIR, `${input.plan_id}.json`)
  await fs.promises.writeFile(abs, JSON.stringify(input, null, 2) + '\n')
  return { success: true, path: abs }
}

export const INSERT_SCENARIO_PLAN_TOOL: Tool<InsertScenarioPlanInput, InsertScenarioPlanOutput> = {
  spec: INSERT_SCENARIO_PLAN_SPEC,
  run: run as (input: InsertScenarioPlanInput) => Promise<InsertScenarioPlanOutput>,
}
