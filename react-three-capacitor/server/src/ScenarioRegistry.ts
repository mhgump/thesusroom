import type { WalkableArea, PhysicsSpec } from './World.js'
import type { NpcSpec } from './npc/NpcSpec.js'
import type { VoteRegionSpec, InstructionEventSpec, FloorGeometrySpec, ButtonSpec } from './GameSpec.js'
import type { GameScript } from './GameScript.js'
import { Room } from './Room.js'
import type { BotSpec } from './bot/BotTypes.js'

export interface MapSpec {
  id: string
  walkable: WalkableArea
  physics?: PhysicsSpec
  npcs: NpcSpec[]
  voteRegions: VoteRegionSpec[]
  geometry?: FloorGeometrySpec[]
  buttons?: ButtonSpec[]
  walkableVariants?: Array<{ triggerIds: string[]; walkable: WalkableArea }>
  doorVariants?: Array<{ triggerIds: string[]; doorIds: string[] }>
  getRoomAtPosition?: (x: number, z: number) => string | null
}

export interface ScenarioSpec {
  id: string
  mapId: string
  instructionSpecs: InstructionEventSpec[]
  // Called once per new Room instance so each room gets a fresh script with no stale state.
  scriptFactory: () => GameScript
  // Initial visibility for geometry elements by id. Geometry defaults to visible (true) unless overridden here.
  // Vote regions always start inactive — scenarios manage them via toggleVoteRegion.
  initialVisibility?: Record<string, boolean>
}

export class ScenarioRegistry {
  private readonly entries: Map<string, { map: MapSpec; scenario: ScenarioSpec }>
  private readonly openRooms: Map<string, Room> = new Map()
  private readonly spawnBotFn: ((scenarioId: string, spec: BotSpec) => void) | undefined

  constructor(entries: { map: MapSpec; scenario: ScenarioSpec }[], spawnBotFn?: (scenarioId: string, spec: BotSpec) => void) {
    this.entries = new Map(entries.map(e => [e.scenario.id, e]))
    this.spawnBotFn = spawnBotFn
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
      map.getRoomAtPosition,
      this.spawnBotFn ? (spec: BotSpec) => this.spawnBotFn!(scenarioId, spec) : undefined,
      map.physics,
      map.doorVariants ?? [],
    )
    this.openRooms.set(scenarioId, room)
    return room
  }
}
