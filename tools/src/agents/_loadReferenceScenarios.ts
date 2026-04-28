// Loads the canonical reference scenarios (scenario1–4 by default) and formats
// them as a markdown block to append to an agent's system prompt.
//
// Included per scenario (if present on disk):
//   - scenario plan JSON (content/scenario_plans/{id}.json)
//   - map source         (content/maps/{id}/map.ts)
//   - scenario source    (content/scenarios/{id}/scenario.ts)
//   - every bot source   (content/bots/{id}/*/bot.ts)
//   - every test spec    (content/scenarios/{id}/test_specs/*/spec.json)
//
// Missing assets are skipped silently — not every scenario has a plan or
// bots. The block is prefixed with a heading so the agent can anchor on it.

import fs from 'node:fs'
import path from 'node:path'
import { CONTENT_DIR } from '../../../shared/paths.js'

function readIfExists(abs: string): string | null {
  try { return fs.readFileSync(abs, 'utf8') } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

function listSubdirs(abs: string): string[] {
  try {
    return fs
      .readdirSync(abs, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

function fence(source: string, lang: string): string {
  return '```' + lang + '\n' + source.trimEnd() + '\n```'
}

function scenarioBlock(scenarioId: string): string {
  const parts: string[] = [`## Reference scenario: \`${scenarioId}\``]

  const planPath = path.join(CONTENT_DIR, 'scenario_plans', `${scenarioId}.json`)
  const planSource = readIfExists(planPath)
  if (planSource !== null) {
    parts.push(`### Plan (\`content/scenario_plans/${scenarioId}.json\`)`)
    parts.push(fence(planSource, 'json'))
  }

  const mapPath = path.join(CONTENT_DIR, 'maps', scenarioId, 'map.ts')
  const mapSource = readIfExists(mapPath)
  if (mapSource !== null) {
    parts.push(`### Map (\`content/maps/${scenarioId}/map.ts\`)`)
    parts.push(fence(mapSource, 'ts'))
  }

  const scenarioPath = path.join(CONTENT_DIR, 'scenarios', scenarioId, 'scenario.ts')
  const scenarioSource = readIfExists(scenarioPath)
  if (scenarioSource !== null) {
    parts.push(`### Scenario (\`content/scenarios/${scenarioId}/scenario.ts\`)`)
    parts.push(fence(scenarioSource, 'ts'))
  }

  const botsDir = path.join(CONTENT_DIR, 'bots', scenarioId)
  const botIds = listSubdirs(botsDir)
  for (const botId of botIds) {
    const botPath = path.join(botsDir, botId, 'bot.ts')
    const source = readIfExists(botPath)
    if (source === null) continue
    parts.push(`### Bot \`${botId}\` (\`content/bots/${scenarioId}/${botId}/bot.ts\`)`)
    parts.push(fence(source, 'ts'))
  }

  const testSpecsDir = path.join(CONTENT_DIR, 'scenarios', scenarioId, 'test_specs')
  const specNames = listSubdirs(testSpecsDir)
  for (const specName of specNames) {
    const specPath = path.join(testSpecsDir, specName, 'spec.json')
    const source = readIfExists(specPath)
    if (source === null) continue
    parts.push(`### Test spec \`${specName}\` (\`content/scenarios/${scenarioId}/test_specs/${specName}/spec.json\`)`)
    parts.push(fence(source, 'json'))
  }

  return parts.join('\n\n')
}

const DEFAULT_REFERENCE_SCENARIOS = ['scenario1', 'scenario2', 'scenario3', 'scenario4']

export function loadReferenceScenarios(
  scenarioIds: string[] = DEFAULT_REFERENCE_SCENARIOS,
): string {
  const header = [
    '# Reference scenarios',
    '',
    'The following canonical scenarios are provided verbatim so you can ' +
    'match their file layout, import style, and API usage. Copy their ' +
    'shape — do NOT probe alternate APIs with `any` or try/catch.',
  ].join('\n')
  const blocks = scenarioIds.map(scenarioBlock)
  return [header, ...blocks].join('\n\n---\n\n')
}

function mapBlock(scenarioId: string): string | null {
  const mapPath = path.join(CONTENT_DIR, 'maps', scenarioId, 'map.ts')
  const source = readIfExists(mapPath)
  if (source === null) return null
  return [
    `## Reference map: \`${scenarioId}\``,
    `### Map (\`content/maps/${scenarioId}/map.ts\`)`,
    fence(source, 'ts'),
  ].join('\n\n')
}

export function loadReferenceMaps(
  scenarioIds: string[] = DEFAULT_REFERENCE_SCENARIOS,
): string {
  const header = [
    '# Reference maps',
    '',
    'The following canonical maps are provided verbatim so you can ' +
    'match their file layout, import style, and API usage. Copy their ' +
    'shape — do NOT probe alternate APIs with `any` or try/catch.',
  ].join('\n')
  const blocks = scenarioIds.map(mapBlock).filter((b): b is string => b !== null)
  return [header, ...blocks].join('\n\n---\n\n')
}
