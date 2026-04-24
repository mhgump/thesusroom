import type { Tool } from '../framework.js'
import { runAgent, type AgentRunResult, type ResponseSpec } from '../_shared/agentLoop.js'
import { INSERT_MAP_TOOL } from '../insertMap/index.js'
import { INSERT_SCENARIO_TOOL } from '../insertScenario/index.js'
import { INSERT_BOT_TOOL } from '../insertBot/index.js'
import { RUN_SCENARIO_WITH_BOTS_TOOL } from '../runScenarioWithBots/index.js'
import { GET_SCENARIO_LOGS_TOOL } from '../getScenarioLogs/index.js'
import { GET_BOT_LOGS_TOOL } from '../getBotLogs/index.js'
import { READ_TEST_SPEC_TOOL } from '../readTestSpec/index.js'
import { LIST_CONTENT_TOOL } from '../listContent/index.js'
import { MAP_AGENT_TOOL } from '../mapAgentTool/index.js'
import { SCENARIO_AGENT_TOOL } from '../scenarioAgentTool/index.js'
import { BOT_AGENT_TOOL } from '../botAgentTool/index.js'
import { RUN_SCENARIO_AGENT_TOOL } from '../runScenarioAgentTool/index.js'
import { loadPrompt } from './_loadPrompt.js'

export interface DirectAgentResponse {
  goal_achieved: boolean
  summary: string
  failure_reason_summary: string
  iterations_used: number
}

export const DIRECT_RESPONSE_SPEC: ResponseSpec = {
  description:
    '{ goal_achieved, summary, failure_reason_summary, iterations_used } — ' +
    'goal_achieved is true iff the user\'s high-level goal was met; summary ' +
    'is a paragraph describing what was built/changed and what the final ' +
    'scenario run showed; failure_reason_summary is a short reason the goal ' +
    'was not met (empty string when goal_achieved=true); iterations_used is ' +
    'how many edit-run cycles the agent performed.',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['goal_achieved', 'summary', 'failure_reason_summary', 'iterations_used'],
    properties: {
      goal_achieved: {
        type: 'boolean',
        description: 'True iff the user\'s goal was met.',
      },
      summary: {
        type: 'string',
        description: 'Paragraph describing what was built and what the final run showed.',
      },
      failure_reason_summary: {
        type: 'string',
        description: 'Short reason the goal was not met; empty string when goal_achieved=true.',
      },
      iterations_used: {
        type: 'integer',
        minimum: 0,
        description: 'Number of edit→run iterations the agent performed.',
      },
    },
  },
}

export async function runDirectAgent(
  userPrompt: string,
  opts: { verbose?: boolean; maxIterations?: number } = {},
): Promise<AgentRunResult<DirectAgentResponse>> {
  return runAgent<DirectAgentResponse>({
    systemPrompt: loadPrompt('direct-agent.md'),
    userPrompt,
    tools: [
      // Sub-agents.
      MAP_AGENT_TOOL as Tool,
      SCENARIO_AGENT_TOOL as Tool,
      BOT_AGENT_TOOL as Tool,
      RUN_SCENARIO_AGENT_TOOL as Tool,
      // Low-level primitives.
      INSERT_MAP_TOOL as Tool,
      INSERT_SCENARIO_TOOL as Tool,
      INSERT_BOT_TOOL as Tool,
      RUN_SCENARIO_WITH_BOTS_TOOL as Tool,
      GET_SCENARIO_LOGS_TOOL as Tool,
      GET_BOT_LOGS_TOOL as Tool,
      // Discovery + inspection.
      LIST_CONTENT_TOOL as Tool,
      READ_TEST_SPEC_TOOL as Tool,
    ],
    responseSpec: DIRECT_RESPONSE_SPEC,
    verbose: opts.verbose,
    maxIterations: opts.maxIterations ?? 60,
  })
}
