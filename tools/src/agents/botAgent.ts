import type { Tool } from '../framework.js'
import { runAgent, type AgentRunResult, type ResponseSpec } from '../_shared/agentLoop.js'
import { withRunLog } from '../_shared/logContext.js'
import { INSERT_BOT_TOOL } from '../insertBot/index.js'
import { loadSkill } from './_loadPrompt.js'
import { loadReferenceScenarios } from './_loadReferenceScenarios.js'

export interface BotAgentResponse {
  bot_name: string
  success: boolean
  failure_reason_summary: string
}

export const BOT_RESPONSE_SPEC: ResponseSpec = {
  description:
    '{ bot_name, success, failure_reason_summary } — bot_name is the slug you ' +
    'wrote (matches insert_bot.bot_id); success is true iff the bot parsed & ' +
    'validated; failure_reason_summary is a short explanation of what blocked ' +
    'success (empty string when success=true).',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['bot_name', 'success', 'failure_reason_summary'],
    properties: {
      bot_name: {
        type: 'string',
        description: 'Slug of the bot written (matches insert_bot.bot_id).',
      },
      success: {
        type: 'boolean',
        description: 'True iff the bot parsed & validated successfully.',
      },
      failure_reason_summary: {
        type: 'string',
        description: 'Short reason if success=false; empty string otherwise.',
      },
    },
  },
}

export async function runBotAgent(
  userPrompt: string,
  opts: { verbose?: boolean; maxIterations?: number } = {},
): Promise<AgentRunResult<BotAgentResponse>> {
  return withRunLog('bot-agent', { prompt: userPrompt }, () =>
    runAgent<BotAgentResponse>({
      systemPrompt:
        loadSkill('bot-agent') + '\n\n---\n\n' + loadReferenceScenarios(),
      userPrompt,
      tools: [INSERT_BOT_TOOL as Tool],
      responseSpec: BOT_RESPONSE_SPEC,
      verbose: opts.verbose,
      maxIterations: opts.maxIterations,
    }),
  )
}
