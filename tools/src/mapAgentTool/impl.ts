import type { Tool } from '../framework.js'
import { runMapAgent } from '../agents/mapAgent.js'
import { MAP_AGENT_SPEC, type MapAgentToolInput, type MapAgentToolOutput } from './spec.js'

function validateInput(input: unknown): MapAgentToolInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<MapAgentToolInput>
  if (typeof i.prompt !== 'string' || !i.prompt) {
    throw new Error('prompt must be a non-empty string')
  }
  return i as MapAgentToolInput
}

async function run(rawInput: unknown): Promise<MapAgentToolOutput> {
  const input = validateInput(rawInput)
  const { response } = await runMapAgent(input.prompt)
  return response
}

export const MAP_AGENT_TOOL: Tool<MapAgentToolInput, MapAgentToolOutput> = {
  spec: MAP_AGENT_SPEC,
  run: run as (input: MapAgentToolInput) => Promise<MapAgentToolOutput>,
}
