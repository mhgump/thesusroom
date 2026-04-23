import type { ScenarioSpec } from '../../react-three-capacitor/server/src/ScenarioRegistry.js'
import type { GameScript } from '../../react-three-capacitor/server/src/GameScript.js'

class Scenario4Script implements GameScript {
  onPlayerConnect(): void {}
}

export const SCENARIO4_SCENARIO: ScenarioSpec = {
  id: 'scenario4',
  scriptFactory: () => new Scenario4Script(),
}
