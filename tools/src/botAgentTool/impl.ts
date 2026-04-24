import type { Tool } from '../framework.js'
import { runBotAgent } from '../agents/botAgent.js'
import {
  BOT_AGENT_SPEC,
  type BotAgentToolInput,
  type BotAgentToolOutput,
} from './spec.js'

function validateInput(input: unknown): BotAgentToolInput {
  if (!input || typeof input !== 'object') throw new Error('input must be an object')
  const i = input as Partial<BotAgentToolInput>
  if (typeof i.prompt !== 'string' || !i.prompt) {
    throw new Error('prompt must be a non-empty string')
  }
  return i as BotAgentToolInput
}

async function run(rawInput: unknown): Promise<BotAgentToolOutput> {
  const input = validateInput(rawInput)
  const { response } = await runBotAgent(input.prompt)
  return response
}

export const BOT_AGENT_TOOL: Tool<BotAgentToolInput, BotAgentToolOutput> = {
  spec: BOT_AGENT_SPEC,
  run: run as (input: BotAgentToolInput) => Promise<BotAgentToolOutput>,
}
