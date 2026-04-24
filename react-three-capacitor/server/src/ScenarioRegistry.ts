import type { GameMap } from '../../src/game/GameMap.js'
import type { GameScript } from './GameScript.js'
import { Room } from './Room.js'
import type { BotSpec } from './bot/BotTypes.js'

export type { GameMap }

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
  timeoutMs: number
  onTerminate(cb: () => void): void
}

export class ScenarioRegistry {
  private readonly entries: Map<string, { map: GameMap; scenario: ScenarioSpec }>
  private readonly openRooms: Map<string, Room> = new Map()
  private readonly allRooms: Map<string, (Room | null)[]> = new Map()
  private readonly spawnBotFn: ((scenarioId: string, spec: BotSpec) => void) | undefined

  constructor(entries: { map: GameMap; scenario: ScenarioSpec }[], spawnBotFn?: (scenarioId: string, spec: BotSpec) => void) {
    this.entries = new Map(entries.map(e => [e.scenario.id, e]))
    this.spawnBotFn = spawnBotFn
  }

  prewarm(scenarioId: string): void {
    this.getOrCreateRoom(scenarioId)
  }

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
    // Assert every room id the scenario requires is actually present in the
    // attached map instance — a missing id fails construction so content bugs
    // surface immediately instead of producing silently inert scripts.
    if (scenario.requiredRoomIds && scenario.requiredRoomIds.length > 0) {
      const availableRoomIds = new Set(
        map.worldSpec.rooms.map(r => `${map.mapInstanceId}_${r.id}`),
      )
      const missing = scenario.requiredRoomIds.filter(id => !availableRoomIds.has(id))
      if (missing.length > 0) {
        throw new Error(
          `Scenario '${scenario.id}' requires room ids not present in map '${map.mapInstanceId}': ${missing.join(', ')}`,
        )
      }
    }
    const room = new Room(
      scenario.id,
      instanceIndex,
      map.walkable,
      map.npcs,
      map.gameSpec,
      scenario.initialVisibility ?? {},
      scenario.initialRoomVisibility ?? {},
      scenario.scriptFactory(),
      () => { this.openRooms.delete(scenarioId) },
      () => {
        const arr = this.allRooms.get(scenarioId)
        if (arr) arr[instanceIndex] = null
      },
      map.walkableVariants ?? [],
      map.getRoomAtPosition ?? undefined,
      this.spawnBotFn ? (spec: BotSpec) => this.spawnBotFn!(scenarioId, spec) : undefined,
      map.physics,
      map.toggleVariants ?? [],
    )

    // Register this map instance with the room's world so the world can track
    // per-player current room and default accessible-room adjacency keyed by
    // scoped room id (`{mapInstanceId}_{localId}`).
    const scopedRoomIds = map.worldSpec.rooms.map(r => `${map.mapInstanceId}_${r.id}`)
    const defaultAdjacency = new Map<string, string[]>()
    for (const scopedId of scopedRoomIds) {
      defaultAdjacency.set(scopedId, map.getAdjacentRoomIds(scopedId))
    }
    room.registerMapInstance({
      mapInstanceId: map.mapInstanceId,
      scopedRoomIds,
      defaultAdjacency,
    })

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
