import fs from 'node:fs'
import path from 'node:path'
import type { Tool } from '../framework.js'
import { TEST_SPECS_DIR } from '../_shared/paths.js'
import type { RunScenarioSpec } from '../_shared/runScenarioSpec.js'
import {
  READ_TEST_SPEC_SPEC,
  type ReadTestSpecInput,
  type ReadTestSpecOutput,
} from './spec.js'

const SLUG_RE = /^[a-zA-Z0-9_-]+$/

function validateInput(input: unknown): ReadTestSpecInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<ReadTestSpecInput>
  if (typeof i.test_spec_name !== 'string' || !i.test_spec_name) {
    throw new Error('test_spec_name must be a non-empty string')
  }
  if (!SLUG_RE.test(i.test_spec_name)) throw new Error('test_spec_name must match [a-zA-Z0-9_-]+')
  return i as ReadTestSpecInput
}

async function run(rawInput: unknown): Promise<ReadTestSpecOutput> {
  let input: ReadTestSpecInput
  try {
    input = validateInput(rawInput)
  } catch (err) {
    return { error: (err as Error).message }
  }
  const absSpecPath = path.join(TEST_SPECS_DIR, `${input.test_spec_name}.json`)
  if (!fs.existsSync(absSpecPath)) {
    return { error: `test spec not found at ${absSpecPath}` }
  }
  try {
    return JSON.parse(fs.readFileSync(absSpecPath, 'utf8')) as RunScenarioSpec
  } catch (err) {
    return { error: `failed to parse test spec: ${(err as Error).message}` }
  }
}

export const READ_TEST_SPEC_TOOL: Tool<ReadTestSpecInput, ReadTestSpecOutput> = {
  spec: READ_TEST_SPEC_SPEC,
  run: run as (input: ReadTestSpecInput) => Promise<ReadTestSpecOutput>,
}
