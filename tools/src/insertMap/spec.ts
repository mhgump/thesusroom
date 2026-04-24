import type { ToolSpec } from '../framework.js'

export interface InsertMapInput {
  // Slug for the map, e.g. "scenario5". Used as the directory name:
  // content/maps/{map_id}/map.ts.
  map_id: string
  // Name of the exported GameMap in the file. MUST be "MAP" — the runtime
  // loader looks up exactly mod.MAP.
  export_name: string
  // Full TypeScript source for content/maps/{map_id}/map.ts.
  file_content: string
}

export type InsertMapOutput =
  | { success: true }
  | { success: false; error: string }

export const INSERT_MAP_SPEC: ToolSpec = {
  name: 'insert_map',
  description:
    'Create or overwrite a map at content/maps/{map_id}/map.ts from the ' +
    'provided TypeScript source, then validate that it exports a valid ' +
    'GameMap. The export MUST be named "MAP" (the runtime loader expects ' +
    'exactly mod.MAP). Returns {success:true} on success, {success:false, ' +
    'error} on parse/validation failure.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['map_id', 'export_name', 'file_content'],
    properties: {
      map_id: {
        type: 'string',
        description:
          'Map slug. Used as directory name under content/maps/ (the source ' +
          'file is written to content/maps/{map_id}/map.ts).',
      },
      export_name: {
        type: 'string',
        description:
          'The exported GameMap constant name. Must be "MAP" — the runtime ' +
          'loader only recognises mod.MAP.',
      },
      file_content: {
        type: 'string',
        description: 'Full TypeScript source written to content/maps/{map_id}/map.ts.',
      },
    },
  },
}
