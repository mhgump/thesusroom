import type { ScenarioSpec } from '../../../react-three-capacitor/server/src/ContentRegistry.js'
import type { GameScript } from '../../../react-three-capacitor/server/src/GameScript.js'

let _terminateCb: (() => void) | null = null

class Scenario4Script implements GameScript {
  onPlayerConnect(): void {}
}

export const SCENARIO: ScenarioSpec = {
  id: 'scenario4',
  timeoutMs: 60_000,
  onTerminate(cb) { _terminateCb = cb },
  scriptFactory: () => new Scenario4Script(),
}
