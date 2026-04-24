import type { Tool } from '../framework.js'
import { getBackends } from '../_shared/backends/index.js'
import {
  ADD_NOTES_TO_TEST_SPEC_SPEC,
  type AddNotesToTestSpecInput,
  type AddNotesToTestSpecOutput,
} from './spec.js'

const SLUG_RE = /^[a-zA-Z0-9_-]+$/

function validateInput(input: unknown): AddNotesToTestSpecInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<AddNotesToTestSpecInput>
  if (typeof i.scenario_id !== 'string' || !i.scenario_id) {
    throw new Error('scenario_id must be a non-empty string')
  }
  if (!SLUG_RE.test(i.scenario_id)) throw new Error('scenario_id must match [a-zA-Z0-9_-]+')
  if (typeof i.test_spec_name !== 'string' || !i.test_spec_name) {
    throw new Error('test_spec_name must be a non-empty string')
  }
  if (!SLUG_RE.test(i.test_spec_name)) throw new Error('test_spec_name must match [a-zA-Z0-9_-]+')
  if (typeof i.author !== 'string' || !i.author) throw new Error('author must be a non-empty string')
  if (typeof i.text !== 'string') throw new Error('text must be a string')
  return i as AddNotesToTestSpecInput
}

async function run(rawInput: unknown): Promise<AddNotesToTestSpecOutput> {
  let input: AddNotesToTestSpecInput
  try {
    input = validateInput(rawInput)
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }

  const { testSpec } = getBackends()
  const key = { scenario_id: input.scenario_id, test_spec_id: input.test_spec_name }
  const spec = await testSpec.get(key)
  if (spec === null) {
    const loc = testSpec.locate?.(key) ?? `${input.scenario_id}/${input.test_spec_name}`
    return { success: false, error: `test spec not found at ${loc}` }
  }

  if (!Array.isArray(spec.notes)) spec.notes = []
  spec.notes.push({ time: Date.now(), author: input.author, text: input.text })
  await testSpec.put(key, spec)

  return { success: true, note_count: spec.notes.length }
}

export const ADD_NOTES_TO_TEST_SPEC_TOOL: Tool<
  AddNotesToTestSpecInput,
  AddNotesToTestSpecOutput
> = {
  spec: ADD_NOTES_TO_TEST_SPEC_SPEC,
  run: run as (input: AddNotesToTestSpecInput) => Promise<AddNotesToTestSpecOutput>,
}
