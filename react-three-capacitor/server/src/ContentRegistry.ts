import type { GameMap } from '../../src/game/GameMap.js'
import type { GameScript } from './GameScript.js'
import { getBackends } from '../../../tools/src/_shared/backends/index.js'
import { validateHubConnection } from './orchestration/hubAttachment.js'
import { MAP as INITIAL_MAP } from '../../../assets/initial/map.js'

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
  // Hard cap on concurrent human+bot players seated in a single room running
  // this scenario. The orchestration layer uses it to gate room selection
  // (`isHubSlotOpen`, transfer-target picking) so a full room stops accepting
  // joins. Scripts that bot-fill to a target count should set this to that
  // count; solo scenarios set it to 1.
  maxPlayers: number
  // Optional hub-attach declaration. When present, this scenario can receive
  // an incoming hub player through the initial hallway. The docking wall,
  // position, and hallway placement are all derived from the named dock
  // geometry — it must exist on `mainRoomId`, sit on that room's south edge,
  // match the hallway's floorWidth, and lie fully within the south wall span.
  // `validateHubConnection` asserts these at content-load time.
  //   `mainRoomId`       — local room id of the scenario's entry room.
  //   `dockGeometryId`   — the toggleable wall segment that opens on reveal.
  hubConnection?: {
    mainRoomId: string
    dockGeometryId: string
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
    if (s.hubConnection) validateHubConnection(m, s.hubConnection, INITIAL_MAP)
    return { map: m, scenario: s }
  }
}
