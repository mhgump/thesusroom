import type { Tool } from '../framework.js'
import { getBackends } from '../../../shared/backends/index.js'
import {
  READ_TEST_SPEC_SPEC,
  type ReadTestSpecInput,
  type ReadTestSpecOutput,
} from './spec.js'

const SLUG_RE = /^[a-zA-Z0-9_-]+$/

function validateInput(input: unknown): ReadTestSpecInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<ReadTestSpecInput>
  if (typeof i.scenario_id !== 'string' || !i.scenario_id) {
    throw new Error('scenario_id must be a non-empty string')
  }
  if (!SLUG_RE.test(i.scenario_id)) throw new Error('scenario_id must match [a-zA-Z0-9_-]+')
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
  const { testSpec } = getBackends()
  const key = { scenario_id: input.scenario_id, test_spec_id: input.test_spec_name }
  const spec = await testSpec.get(key)
  if (spec === null) {
    const loc = testSpec.locate?.(key) ?? `${input.scenario_id}/${input.test_spec_name}`
    return { error: `test spec not found at ${loc}` }
  }
  return spec
}

export const READ_TEST_SPEC_TOOL: Tool<ReadTestSpecInput, ReadTestSpecOutput> = {
  spec: READ_TEST_SPEC_SPEC,
  run: run as (input: ReadTestSpecInput) => Promise<ReadTestSpecOutput>,
}
