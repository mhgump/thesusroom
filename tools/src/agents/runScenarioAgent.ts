import type { Tool } from '../framework.js'
import { runAgent, type AgentRunResult, type ResponseSpec } from '../_shared/agentLoop.js'
import { RUN_SCENARIO_WITH_BOTS_TOOL } from '../runScenarioWithBots/index.js'
import { GET_SCENARIO_LOGS_TOOL } from '../getScenarioLogs/index.js'
import { GET_BOT_LOGS_TOOL } from '../getBotLogs/index.js'
import { loadPrompt } from './_loadPrompt.js'

export interface RunScenarioAgentResponse {
  achieved_goal: boolean
  summary: string
  failure_reason_summary: string
  run_artifact_id: string
}

export const RUN_SCENARIO_RESPONSE_SPEC: ResponseSpec = {
  description:
    '{ achieved_goal, summary, failure_reason_summary, run_artifact_id } — ' +
    'achieved_goal is true iff the prompt\'s goal was met by the run; summary ' +
    'is a one-paragraph description of what happened (complete/timeout, ' +
    'survivors, notable log events); failure_reason_summary is a short reason ' +
    'the goal was not met (empty string when achieved_goal=true); ' +
    'run_artifact_id is the artifact id you used (empty string if no run ' +
    'succeeded enough to produce one).',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['achieved_goal', 'summary', 'failure_reason_summary', 'run_artifact_id'],
    properties: {
      achieved_goal: {
        type: 'boolean',
        description: 'True iff the prompt\'s goal was achieved by the run.',
      },
      summary: {
        type: 'string',
        description: 'One-paragraph description of what happened during the run.',
      },
      failure_reason_summary: {
        type: 'string',
        description: 'Short reason the goal was not met; empty string when achieved_goal=true.',
      },
      run_artifact_id: {
        type: 'string',
        description: 'Artifact id of the run (empty string if no artifact was produced).',
      },
    },
  },
}

export async function runRunScenarioAgent(
  userPrompt: string,
  opts: { verbose?: boolean; maxIterations?: number } = {},
): Promise<AgentRunResult<RunScenarioAgentResponse>> {
  return runAgent<RunScenarioAgentResponse>({
    systemPrompt: loadPrompt('run-scenario-agent.md'),
    userPrompt,
    tools: [
      RUN_SCENARIO_WITH_BOTS_TOOL as Tool,
      GET_SCENARIO_LOGS_TOOL as Tool,
      GET_BOT_LOGS_TOOL as Tool,
    ],
    responseSpec: RUN_SCENARIO_RESPONSE_SPEC,
    verbose: opts.verbose,
    maxIterations: opts.maxIterations,
  })
}
