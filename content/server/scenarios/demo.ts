import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ScenarioRegistry.js'
import { DemoGameScript } from '../../../react-three-capacitor/server/src/scripts/DemoGameScript.js'

export const DEMO_SCENARIO: ScenarioSpec = {
  id: 'demo',
  mapId: 'demo',
  instructionSpecs: [
    { id: 'vote_instruction', text: 'Vote Yes or No', label: 'COMMAND' },
  ],
  scriptFactory: () => new DemoGameScript(),
  initialVisibility: {},
}
