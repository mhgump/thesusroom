import fs from 'node:fs'
import path from 'node:path'
import type { Tool } from '../framework.js'
import { TEST_SPECS_DIR } from '../_shared/paths.js'
import type { RunScenarioSpec } from '../_shared/runScenarioSpec.js'
import {
  ADD_NOTES_TO_TEST_SPEC_SPEC,
  type AddNotesToTestSpecInput,
  type AddNotesToTestSpecOutput,
} from './spec.js'

const SLUG_RE = /^[a-zA-Z0-9_-]+$/

function validateInput(input: unknown): AddNotesToTestSpecInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<AddNotesToTestSpecInput>
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

  const absSpecPath = path.join(TEST_SPECS_DIR, `${input.test_spec_name}.json`)
  if (!fs.existsSync(absSpecPath)) {
    return { success: false, error: `test spec not found at ${absSpecPath}` }
  }

  let spec: RunScenarioSpec
  try {
    spec = JSON.parse(fs.readFileSync(absSpecPath, 'utf8')) as RunScenarioSpec
  } catch (err) {
    return { success: false, error: `failed to parse test spec: ${(err as Error).message}` }
  }

  if (!Array.isArray(spec.notes)) spec.notes = []
  spec.notes.push({ time: Date.now(), author: input.author, text: input.text })
  fs.writeFileSync(absSpecPath, JSON.stringify(spec, null, 2) + '\n')

  return { success: true, note_count: spec.notes.length }
}

export const ADD_NOTES_TO_TEST_SPEC_TOOL: Tool<
  AddNotesToTestSpecInput,
  AddNotesToTestSpecOutput
> = {
  spec: ADD_NOTES_TO_TEST_SPEC_SPEC,
  run: run as (input: AddNotesToTestSpecInput) => Promise<AddNotesToTestSpecOutput>,
}
