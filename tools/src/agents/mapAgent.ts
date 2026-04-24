import type { Tool } from '../framework.js'
import { runAgent, type AgentRunResult, type ResponseSpec } from '../_shared/agentLoop.js'
import { INSERT_MAP_TOOL } from '../insertMap/index.js'
import { loadSkill } from './_loadPrompt.js'

export interface MapAgentResponse {
  map_name: string
  success: boolean
  failure_reason_summary: string
}

export const MAP_RESPONSE_SPEC: ResponseSpec = {
  description:
    '{ map_name, success, failure_reason_summary } — map_name is the slug you ' +
    'wrote (matches insert_map.map_id); success is true iff the map parsed & ' +
    'validated; failure_reason_summary is a short (<200 chars) explanation of ' +
    'what blocked success (empty string when success=true).',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['map_name', 'success', 'failure_reason_summary'],
    properties: {
      map_name: {
        type: 'string',
        description: 'Slug of the map written (matches insert_map.map_id).',
      },
      success: {
        type: 'boolean',
        description: 'True iff the map parsed & validated successfully.',
      },
      failure_reason_summary: {
        type: 'string',
        description: 'Short reason if success=false; empty string otherwise.',
      },
    },
  },
}

export async function runMapAgent(
  userPrompt: string,
  opts: { verbose?: boolean; maxIterations?: number } = {},
): Promise<AgentRunResult<MapAgentResponse>> {
  return runAgent<MapAgentResponse>({
    systemPrompt: loadSkill('map-agent'),
    userPrompt,
    tools: [INSERT_MAP_TOOL as Tool],
    responseSpec: MAP_RESPONSE_SPEC,
    verbose: opts.verbose,
    maxIterations: opts.maxIterations,
  })
}
