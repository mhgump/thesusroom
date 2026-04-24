import type { ToolSpec } from '../framework.js'

export interface InsertMapInput {
  // Slug for the map, e.g. "scenario5". Used as the filename: content/maps/{map_id}.ts.
  map_id: string
  // Name of the exported GameMap in the file, e.g. "SCENARIO5_MAP".
  export_name: string
  // Full TypeScript source for content/maps/{map_id}.ts.
  file_content: string
}

export type InsertMapOutput =
  | { success: true }
  | { success: false; error: string }

export const INSERT_MAP_SPEC: ToolSpec = {
  name: 'insert_map',
  description:
    'Create or overwrite a map at content/maps/{map_id}.ts from the provided ' +
    'TypeScript source, then validate that it exports a valid GameMap. Returns ' +
    '{success:true} on success, {success:false, error} on parse/validation failure.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['map_id', 'export_name', 'file_content'],
    properties: {
      map_id: {
        type: 'string',
        description: 'Map slug. Used as filename under content/maps/ (e.g. "scenario5").',
      },
      export_name: {
        type: 'string',
        description: 'The exported GameMap constant name (e.g. "SCENARIO5_MAP").',
      },
      file_content: {
        type: 'string',
        description: 'Full TypeScript source written to content/maps/{map_id}.ts.',
      },
    },
  },
}
