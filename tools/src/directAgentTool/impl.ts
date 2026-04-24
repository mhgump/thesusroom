import type { Tool } from '../framework.js'
import { runDirectAgent } from '../agents/directAgent.js'
import {
  DIRECT_AGENT_SPEC,
  type DirectAgentToolInput,
  type DirectAgentToolOutput,
} from './spec.js'

function validateInput(input: unknown): DirectAgentToolInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<DirectAgentToolInput>
  if (typeof i.prompt !== 'string' || !i.prompt) {
    throw new Error('prompt must be a non-empty string')
  }
  return i as DirectAgentToolInput
}

async function run(rawInput: unknown): Promise<DirectAgentToolOutput> {
  const input = validateInput(rawInput)
  const { response } = await runDirectAgent(input.prompt)
  return response
}

export const DIRECT_AGENT_TOOL: Tool<DirectAgentToolInput, DirectAgentToolOutput> = {
  spec: DIRECT_AGENT_SPEC,
  run: run as (input: DirectAgentToolInput) => Promise<DirectAgentToolOutput>,
}
