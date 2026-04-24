import type { ToolSpec } from '../framework.js'
import type { MapAgentResponse } from '../agents/mapAgent.js'

export interface MapAgentToolInput {
  prompt: string
}

export type MapAgentToolOutput = MapAgentResponse

export const MAP_AGENT_SPEC: ToolSpec = {
  name: 'map_agent',
  description:
    'Delegate to a Map Agent that designs a GameMap from a natural-language ' +
    'prompt, persists it to content/maps/{map_id}.ts, and iterates until the ' +
    'file parses and validates. Returns {map_name, success, failure_reason_summary}.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['prompt'],
    properties: {
      prompt: {
        type: 'string',
        description:
          'Instruction for the map agent — what map to build, desired rooms, ' +
          'connections, and any constraints.',
      },
    },
  },
}
