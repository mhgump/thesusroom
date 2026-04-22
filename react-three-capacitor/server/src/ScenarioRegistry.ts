import type { WalkableArea } from './World.js'
import type { NpcSpec } from './npc/NpcSpec.js'
import type { VoteRegionSpec, InstructionEventSpec, FloorGeometrySpec, ButtonSpec } from './GameSpec.js'
import type { GameScript } from './GameScript.js'
import { Room } from './Room.js'

export interface MapSpec {
  id: string
  walkable: WalkableArea
  npcs: NpcSpec[]
  voteRegions: VoteRegionSpec[]
  geometry?: FloorGeometrySpec[]
  buttons?: ButtonSpec[]
  walkableVariants?: Array<{ triggerIds: string[]; walkable: WalkableArea }>
}

export interface ScenarioSpec {
  id: string
  mapId: string
  instructionSpecs: InstructionEventSpec[]
  // Called once per new Room instance so each room gets a fresh script with no stale state.
  scriptFactory: () => GameScript
  // Initial visibility for map elements by id (vote regions and geometry).
  // Geometry defaults to visible (true); vote regions default to inactive (false).
  initialVisibility?: Record<string, boolean>
}

export class ScenarioRegistry {
  private readonly entries: Map<string, { map: MapSpec; scenario: ScenarioSpec }>
  private readonly openRooms: Map<string, Room> = new Map()

  constructor(entries: { map: MapSpec; scenario: ScenarioSpec }[]) {
    this.entries = new Map(entries.map(e => [e.scenario.id, e]))
  }

  prewarm(scenarioId: string): void {
    this.getOrCreateRoom(scenarioId)
  }

  // Returns the open Room for this scenario, creating one if needed.
  // Returns null if the scenario name is unknown or its room has been closed.
  getOrCreateRoom(scenarioId: string): Room | null {
    const existing = this.openRooms.get(scenarioId)
    if (existing) return existing

    const entry = this.entries.get(scenarioId)
    if (!entry) return null

    const { map, scenario } = entry
    const room = new Room(
      scenario.id,
      map.walkable,
      map.npcs,
      {
        instructionSpecs: scenario.instructionSpecs,
        voteRegions: map.voteRegions,
        geometry: map.geometry ?? [],
        buttons: map.buttons ?? [],
        initialVisibility: scenario.initialVisibility ?? {},
      },
      scenario.scriptFactory(),
      () => { this.openRooms.delete(scenarioId) },
      map.walkableVariants ?? [],
    )
    this.openRooms.set(scenarioId, room)
    return room
  }
}
