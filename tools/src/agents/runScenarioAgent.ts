import type { Tool } from '../framework.js'
import { runAgent, type AgentRunResult, type ResponseSpec } from '../_shared/agentLoop.js'
import { withRunLog } from '../_shared/logContext.js'
import { INSERT_RUN_SCENARIO_SPEC_TOOL } from '../insertRunScenarioSpec/index.js'
import { RUN_SCENARIO_FROM_SPEC_TOOL } from '../runScenarioFromSpec/index.js'
import { ADD_NOTES_TO_TEST_SPEC_TOOL } from '../addNotesToTestSpec/index.js'
import { READ_TEST_SPEC_TOOL } from '../readTestSpec/index.js'
import { LIST_CONTENT_TOOL } from '../listContent/index.js'
import { GET_SCENARIO_LOGS_TOOL } from '../getScenarioLogs/index.js'
import { GET_BOT_LOGS_TOOL } from '../getBotLogs/index.js'
import { loadSkill } from './_loadPrompt.js'
import { loadReferenceScenarios } from './_loadReferenceScenarios.js'

export interface RunScenarioAgentResponse {
  scenario_id: string
  test_spec_name: string
  success: boolean
}

export const RUN_SCENARIO_RESPONSE_SPEC: ResponseSpec = {
  description:
    '{ scenario_id, test_spec_name, success } — identifies the spec created at ' +
    'content/scenarios/{scenario_id}/test_specs/{test_spec_name}/spec.json; ' +
    'success is true iff the prompt\'s goal was met by the run. Full reasoning ' +
    'lives in the spec\'s notes array.',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['scenario_id', 'test_spec_name', 'success'],
    properties: {
      scenario_id: {
        type: 'string',
        description: 'Scenario slug the test spec belongs to.',
      },
      test_spec_name: {
        type: 'string',
        description: 'Slug of the test spec this attempt produced.',
      },
      success: {
        type: 'boolean',
        description: 'True iff the prompt\'s goal was achieved by the run.',
      },
    },
  },
}

export async function runRunScenarioAgent(
  userPrompt: string,
  opts: { verbose?: boolean; maxIterations?: number } = {},
): Promise<AgentRunResult<RunScenarioAgentResponse>> {
  return withRunLog('run-scenario-agent', { prompt: userPrompt }, () =>
    runAgent<RunScenarioAgentResponse>({
      systemPrompt:
        loadSkill('run-scenario-agent') + '\n\n---\n\n' + loadReferenceScenarios(),
      userPrompt,
      tools: [
        INSERT_RUN_SCENARIO_SPEC_TOOL as Tool,
        RUN_SCENARIO_FROM_SPEC_TOOL as Tool,
        ADD_NOTES_TO_TEST_SPEC_TOOL as Tool,
        READ_TEST_SPEC_TOOL as Tool,
        LIST_CONTENT_TOOL as Tool,
        GET_SCENARIO_LOGS_TOOL as Tool,
        GET_BOT_LOGS_TOOL as Tool,
      ],
      responseSpec: RUN_SCENARIO_RESPONSE_SPEC,
      verbose: opts.verbose,
      maxIterations: opts.maxIterations,
    }),
  )
}
