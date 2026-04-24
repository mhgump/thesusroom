import type { ToolSpec } from '../framework.js'

export interface InsertScenarioInput {
  // Slug for the scenario, e.g. "scenario5". Used as the directory name:
  // content/scenarios/{scenario_id}/scenario.ts.
  scenario_id: string
  // The map this scenario runs on. Must correspond to an existing map file at
  // content/maps/{map_id}/map.ts.
  map_id: string
  // Name of the exported ScenarioSpec in the file, e.g. "SCENARIO5_SCENARIO".
  export_name: string
  // Full TypeScript source for content/scenarios/{scenario_id}/scenario.ts.
  file_content: string
}

export type InsertScenarioOutput =
  | { success: true; scenario_index: number }
  | { success: false; error: string }

export const INSERT_SCENARIO_SPEC: ToolSpec = {
  name: 'insert_scenario',
  description:
    'Create or overwrite a scenario at content/scenarios/{scenario_id}/scenario.ts ' +
    'from the provided TypeScript source. The scenario is tied to a map via ' +
    'map_id; the corresponding content/maps/{map_id}/map.ts must already exist. ' +
    'Appends the scenario to content/scenario_map.json (if not already present). ' +
    'Validates that the file exports a valid ScenarioSpec. Returns ' +
    '{success:true, scenario_index} on success, {success:false, error} on ' +
    'parse/validation failure.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['scenario_id', 'map_id', 'export_name', 'file_content'],
    properties: {
      scenario_id: {
        type: 'string',
        description: 'Scenario slug. Used as directory name under content/scenarios/.',
      },
      map_id: {
        type: 'string',
        description:
          'Slug of the map this scenario runs on (must exist at content/maps/{map_id}/map.ts).',
      },
      export_name: {
        type: 'string',
        description: 'The exported ScenarioSpec constant name (e.g. "SCENARIO5_SCENARIO").',
      },
      file_content: {
        type: 'string',
        description:
          'Full TypeScript source written to content/scenarios/{scenario_id}/scenario.ts.',
      },
    },
  },
}
