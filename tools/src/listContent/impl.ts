import path from 'node:path'
import type { Tool } from '../framework.js'
import { getDataBackend } from '../_shared/backends/index.js'
import { PROJECT_ROOT } from '../_shared/paths.js'
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

  const { bot, map, scenario, testSpec } = getDataBackend()

  const scenarios: ListedScenario[] = []
  const maps: ListedMap[] = []
  const bots: ListedBot[] = []
  const testSpecs: Record<string, ListedTestSpec[]> = {}

  const scenarioIndex = await scenario.listIndex()

  if (wantScenarios) {
    for (const [index, name] of scenarioIndex.entries()) {
      if (!scenarioRe.test(name)) continue
      const abs = scenario.locate?.(name)
      const p = abs ? relPath(abs) : `content/scenarios/${name}/scenario.ts`
      scenarios.push({ name, index, path: p })
    }
  }

  if (wantMaps) {
    for (const { key } of await map.list()) {
      if (!mapRe.test(key)) continue
      const abs = map.locate?.(key)
      const p = abs ? relPath(abs) : `content/maps/${key}/map.ts`
      maps.push({ name: key, path: p })
    }
  }

  if (wantBots) {
    for (const { key } of await bot.list()) {
      if (!botRe.test(key.bot_id)) continue
      const abs = bot.locate?.(key)
      const p = abs ? relPath(abs) : `content/bots/${key.scenario_id}/${key.bot_id}/bot.ts`
      bots.push({ name: key.bot_id, scenario_id: key.scenario_id, path: p })
    }
  }

  if (wantTestSpecs) {
    for (const scenarioId of scenarioIndex) {
      testSpecs[scenarioId] = []
    }
    for (const scenarioId of scenarioIndex) {
      const names = await testSpec.listIndex(scenarioId)
      for (const [index, name] of names.entries()) {
        if (!testSpecRe.test(name)) continue
        const key = { scenario_id: scenarioId, test_spec_id: name }
        const value = await testSpec.get(key)
        if (value === null) continue
        const abs = testSpec.locate?.(key)
        const p = abs ? relPath(abs) : `content/scenarios/${scenarioId}/test_specs/${name}/spec.json`
        testSpecs[scenarioId].push({
          name,
          index,
          path: p,
          scenario_id: typeof value.scenario_id === 'string' ? value.scenario_id : scenarioId,
          map_id: typeof value.map_id === 'string' ? value.map_id : '',
          bot_count: Array.isArray(value.bots) ? value.bots.length : 0,
          note_count: Array.isArray(value.notes) ? value.notes.length : 0,
        })
      }
    }
  }

  return { scenarios, maps, bots, test_specs: testSpecs }
}

export const LIST_CONTENT_TOOL: Tool<ListContentInput, ListContentOutput> = {
  spec: LIST_CONTENT_SPEC,
  run: run as (input: ListContentInput) => Promise<ListContentOutput>,
}
