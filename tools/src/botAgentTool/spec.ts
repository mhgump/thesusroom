import type { ToolSpec } from '../framework.js'
import type { BotAgentResponse } from '../agents/botAgent.js'

export interface BotAgentToolInput {
  prompt: string
}

export type BotAgentToolOutput = BotAgentResponse

export const BOT_AGENT_SPEC: ToolSpec = {
  name: 'bot_agent',
  description:
    'Delegate to a Bot Agent that designs a BotSpec tied to an existing ' +
    'scenario, persists it to content/bots/{scenario_id}/{bot_id}.ts, and ' +
    'iterates until the file parses and validates. Returns ' +
    '{bot_name, success, failure_reason_summary}.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['prompt'],
    properties: {
      prompt: {
        type: 'string',
        description:
          'Instruction for the bot agent — which scenario it plays, behaviors ' +
          'to exhibit, and any constraints.',
      },
    },
  },
}
