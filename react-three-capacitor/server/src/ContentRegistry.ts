import type { GameMap } from '../../src/game/GameMap.js'
import type { GameScript } from './GameScript.js'

export type { GameMap }

// What a scenario contributes to a room instance: its script, content-level
// visibility overrides, and content-level assertions. Orchestration policy
// (when to open/close the room, how many are allowed at once) lives outside
// this type — see `server/src/orchestration/`.
export interface ScenarioSpec {
  id: string
  scriptFactory: () => GameScript
  initialVisibility?: Record<string, boolean>
  // Keyed by scoped room id (`{mapInstanceId}_{localRoomId}`).
  initialRoomVisibility?: Record<string, boolean>
  // Scoped room ids the scenario requires to exist in the attached room set.
  // Asserted when the scenario is attached to a world — a missing id fails
  // construction so content bugs surface immediately.
  requiredRoomIds?: string[]
  // Used only by the `run-scenario` CLI harness (`server/scripts/run-scenario.ts`)
  // to bound a test run and detect early termination. Not consulted by the
  // production server or by any orchestration.
  timeoutMs: number
  onTerminate(cb: () => void): void
}

// Static catalogue of shipped scenarios keyed by id. Pure lookup — owns no
// runtime state.
export class ContentRegistry {
  private readonly entries: Map<string, { map: GameMap; scenario: ScenarioSpec }>

  constructor(entries: { map: GameMap; scenario: ScenarioSpec }[]) {
    this.entries = new Map(entries.map(e => [e.scenario.id, e]))
  }

  get(scenarioId: string): { map: GameMap; scenario: ScenarioSpec } | undefined {
    return this.entries.get(scenarioId)
  }

  has(scenarioId: string): boolean {
    return this.entries.has(scenarioId)
  }
}
