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
  toggleVariants?: Array<{ triggerIds: string[]; toggleIds: string[] }>
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
  // Stable per-scenario index → room mapping. Closed rooms become null; new rooms
  // fill the lowest available null slot so indices remain consistent across rooms.
  private readonly allRooms: Map<string, (Room | null)[]> = new Map()
  private readonly spawnBotFn: ((scenarioId: string, spec: BotSpec) => void) | undefined

  constructor(entries: { map: MapSpec; scenario: ScenarioSpec }[], spawnBotFn?: (scenarioId: string, spec: BotSpec) => void) {
    this.entries = new Map(entries.map(e => [e.scenario.id, e]))
    this.spawnBotFn = spawnBotFn
  }

  prewarm(scenarioId: string): void {
    this.getOrCreateRoom(scenarioId)
  }

  // Returns the open Room for this scenario, creating one if needed.
  // Returns null if the scenario name is unknown.
  getOrCreateRoom(scenarioId: string): Room | null {
    const existing = this.openRooms.get(scenarioId)
    if (existing) return existing

    const entry = this.entries.get(scenarioId)
    if (!entry) return null

    const instances = this.allRooms.get(scenarioId) ?? []
    if (!this.allRooms.has(scenarioId)) this.allRooms.set(scenarioId, instances)
    const nullSlot = instances.findIndex(r => r === null)
    const instanceIndex = nullSlot !== -1 ? nullSlot : instances.length

    const { map, scenario } = entry
    const room = new Room(
      scenario.id,
      instanceIndex,
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
      () => {
        this.openRooms.delete(scenarioId)
        const arr = this.allRooms.get(scenarioId)
        if (arr) arr[instanceIndex] = null
      },
      map.walkableVariants ?? [],
      map.getRoomAtPosition,
      this.spawnBotFn ? (spec: BotSpec) => this.spawnBotFn!(scenarioId, spec) : undefined,
      map.physics,
      map.toggleVariants ?? [],
    )

    if (nullSlot !== -1) {
      instances[nullSlot] = room
    } else {
      instances.push(room)
    }
    this.openRooms.set(scenarioId, room)
    return room
  }

  getRoomByIndex(scenarioId: string, i: number): Room | null {
    return this.allRooms.get(scenarioId)?.[i] ?? null
  }

  hasRoomAndPlayer(scenarioId: string, i: number, j: number): boolean {
    const room = this.getRoomByIndex(scenarioId, i)
    return room !== null && room.getPlayerIdByIndex(j) !== null
  }
}
