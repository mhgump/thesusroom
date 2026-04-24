import type { GameMap } from '../../src/game/GameMap.js'
import type { Wall } from '../../src/game/RoomSpec.js'
import type { GameScript } from './GameScript.js'
import { getBackends } from '../../../tools/src/_shared/backends/index.js'

export type { GameMap }

// What a scenario contributes to a room instance: its script, content-level
// visibility overrides, and content-level assertions. Orchestration policy
// (when to open/close the room, how many are allowed at once) lives outside
// this type — see `server/src/orchestration/`.
//
// `script` is a single shared `GameScript<S>` object (no factory). The
// per-scenario mutable state lives inside the `Scenario` class — produced by
// `script.initialState()` — so scripts must be pure behavior definitions
// with no instance fields or module-scope mutable bindings. Scripts signal
// "I succeeded" by calling `ctx.terminate()`; the enclosing room forwards
// that to any listener wired through `MultiplayerRoomOptions.onScenarioTerminate`.
export interface ScenarioSpec {
  id: string
  script: GameScript<any>
  initialVisibility?: Record<string, boolean>
  // Keyed by scoped room id (`{mapInstanceId}_{localRoomId}`).
  initialRoomVisibility?: Record<string, boolean>
  // Scoped room ids the scenario requires to exist in the attached room set.
  // Asserted when the scenario is attached to a world — a missing id fails
  // construction so content bugs surface immediately.
  requiredRoomIds?: string[]
  // World-space spawn position for players attached to this scenario. When
  // omitted, players spawn at the world origin (legacy default). Orchestrations
  // read this and thread it through to `MultiplayerRoom.connectPlayer`.
  spawn?: { x: number; z: number }
  // Used only by the `run-scenario` CLI harness (`server/scripts/run-scenario.ts`)
  // to bound a test run and detect early termination. Not consulted by the
  // production server or by any orchestration.
  timeoutMs: number
  // Optional hub-attach declaration. When present, this scenario can receive
  // an incoming hub player through the initial hallway. The orchestration
  // uses these fields (plus the initial hallway's geometry) to compute the
  // hallway's world placement and the cross-instance adjacency edge, without
  // any scenario-specific constants in the hub code.
  //   `mainRoomId`        — local room id of the scenario's entry room.
  //   `wallSide`          — which wall of that room the hallway docks against.
  //   `wallGeometryId`    — the toggleable wall segment that opens on reveal.
  //   `positionOnWall`    — 0..1 along the wall where the hallway centres.
  hubConnection?: {
    mainRoomId: string
    wallSide: Wall
    wallGeometryId: string
    positionOnWall: number
  }
}

export type ContentEntry = { map: GameMap; scenario: ScenarioSpec }

// Lazy, cached view over scenario + map content in the data backend. `get(id)`
// returns the cached entry on a hit; on a miss it loads via the backend and
// memoizes the in-flight promise so concurrent cold requests share one load.
// Entries that fail to load (null or thrown) are evicted so a retry can pick
// up a later fix without restarting the server.
export class ContentRegistry {
  private readonly cache: Map<string, Promise<ContentEntry | undefined>> = new Map()

  async get(scenarioId: string): Promise<ContentEntry | undefined> {
    const cached = this.cache.get(scenarioId)
    if (cached) return cached
    const p = this.loadEntry(scenarioId)
    this.cache.set(scenarioId, p)
    p.then(
      v => { if (v === undefined) this.cache.delete(scenarioId) },
      () => { this.cache.delete(scenarioId) },
    )
    return p
  }

  private async loadEntry(scenarioId: string): Promise<ContentEntry | undefined> {
    const { scenario, map } = getBackends()
    const [s, m] = await Promise.all([scenario.load(scenarioId), map.load(scenarioId)])
    if (!s || !m) return undefined
    return { map: m, scenario: s }
  }
}
