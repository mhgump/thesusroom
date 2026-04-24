import type { MultiplayerRoom } from './Room.js'
import type { RoomOrchestration, RoomCreationContext } from './orchestration/RoomOrchestration.js'
import type { PlayerRecordingManager } from './PlayerRecordingManager.js'

// Snapshot of a single live multiplayer room — everything transfer-target
// selection and operational tooling care about, without handing out the
// underlying MultiplayerRoom reference. `openScenarioId` is the scenario
// currently accepting joins (null while the room is running but closed to
// new connections). `isOpen` reflects room-level `!closed`; `isHubSlotOpen`
// is the orchestration-agnostic hub-transfer eligibility check, which also
// enforces `maxPlayers`.
export interface RoomSummary {
  routingKey: string
  instanceIndex: number
  roomId: string
  openScenarioId: string | null
  playerCount: number
  maxPlayers: number
  isOpen: boolean
  isHubSlotOpen: boolean
}

// Owns the live set of shared multiplayer rooms keyed by routing key. Decides
// whether to reuse an existing open room or spin up a new one, and keeps a
// stable per-key index so observer URLs (`/observe/{key}/{i}/{j}`) survive
// room churn.
//
// Registry is orchestration-agnostic: each call site hands it the
// `RoomOrchestration` governing the key so the registry can build new rooms
// and prune closed ones without knowing what policy the orchestration
// implements. Private per-connection rooms (e.g. solo hallways constructed by
// `DefaultGameOrchestration`) are never registered here.
export class MultiplayerRoomRegistry {
  private readonly openRooms: Map<string, MultiplayerRoom[]> = new Map()
  private readonly allRooms: Map<string, (MultiplayerRoom | null)[]> = new Map()

  constructor(private readonly recordingManager?: PlayerRecordingManager) {}

  // Find an already-open room for `key` or create a fresh one via `orch`.
  // Every scenario-seating path funnels through here so the open-pool and
  // per-key index stay consistent.
  getOrCreateOpenRoom(key: string, orch: RoomOrchestration): MultiplayerRoom {
    return this.pickOpenRoomForKey(key, orch) ?? this.ensureRoomForKey(key, orch)
  }

  // Hub-transfer variant: picks an existing open room whose `isHubSlotOpen()`
  // is true, or creates a fresh one. Returns null only if the caller passed a
  // null orchestration (shouldn't happen — callers resolve upstream).
  findOrCreateHubSlot(key: string, orch: RoomOrchestration): MultiplayerRoom {
    const open = this.openRooms.get(key)
    if (open) {
      for (const room of open) {
        if (orch.isOpen(room) && room.isHubSlotOpen()) return room
      }
    }
    return this.ensureRoomForKey(key, orch)
  }

  getRoomByIndex(key: string, i: number): MultiplayerRoom | null {
    return this.allRooms.get(key)?.[i] ?? null
  }

  // Snapshot every live room across every routing key (or just one key if
  // `filterKey` is supplied). Excludes slots that have already been freed.
  // Intended for transfer-target picking — callers read it, score the
  // candidates, and hand the winning `routingKey` back to the dispatcher /
  // `findOrCreateHubSlot`. Does NOT include solo-hallway MRs built by
  // `DefaultGameOrchestration` (those are private per-connection and never
  // registered).
  listRooms(filterKey?: string): RoomSummary[] {
    const out: RoomSummary[] = []
    const keys = filterKey !== undefined ? [filterKey] : [...this.allRooms.keys()]
    for (const key of keys) {
      const slots = this.allRooms.get(key)
      if (!slots) continue
      for (let i = 0; i < slots.length; i++) {
        const room = slots[i]
        if (!room) continue
        out.push({
          routingKey: key,
          instanceIndex: i,
          roomId: room.roomId,
          openScenarioId: room.getOpenScenarioId(),
          playerCount: room.getPlayerCount(),
          maxPlayers: room.maxPlayers,
          isOpen: room.isOpen(),
          isHubSlotOpen: room.isHubSlotOpen(),
        })
      }
    }
    return out
  }

  hasRoomAndPlayer(key: string, i: number, j: number): boolean {
    const room = this.getRoomByIndex(key, i)
    return room !== null && room.getPlayerIdByIndex(j) !== null
  }

  // Picks a random open room for the key, or null if there isn't one. Lazily
  // prunes rooms whose orchestration now reports them closed — this normally
  // happens via the onClose callback, but polling isOpen here guards against
  // an orchestration that forgets to fire the callback.
  private pickOpenRoomForKey(key: string, orch: RoomOrchestration): MultiplayerRoom | null {
    const open = this.openRooms.get(key)
    if (!open || open.length === 0) return null
    for (let i = open.length - 1; i >= 0; i--) {
      if (!orch.isOpen(open[i])) open.splice(i, 1)
    }
    if (open.length === 0) {
      this.openRooms.delete(key)
      return null
    }
    return open[Math.floor(Math.random() * open.length)]
  }

  private ensureRoomForKey(key: string, orch: RoomOrchestration): MultiplayerRoom {
    const slots = this.allRooms.get(key) ?? []
    if (!this.allRooms.has(key)) this.allRooms.set(key, slots)
    const nullSlot = slots.findIndex(r => r === null)
    const instanceIndex = nullSlot !== -1 ? nullSlot : slots.length

    let room!: MultiplayerRoom
    const ctx: RoomCreationContext = {
      routingKey: key,
      instanceIndex,
      onClose: () => this.removeFromOpen(key, room),
      onDestroy: () => this.freeSlot(key, instanceIndex),
      recordingManager: this.recordingManager,
    }
    room = orch.createRoom(ctx)

    if (nullSlot !== -1) slots[nullSlot] = room
    else slots.push(room)

    const open = this.openRooms.get(key) ?? []
    if (!this.openRooms.has(key)) this.openRooms.set(key, open)
    open.push(room)

    return room
  }

  private removeFromOpen(key: string, room: MultiplayerRoom): void {
    const open = this.openRooms.get(key)
    if (!open) return
    const idx = open.indexOf(room)
    if (idx >= 0) open.splice(idx, 1)
    if (open.length === 0) this.openRooms.delete(key)
  }

  private freeSlot(key: string, instanceIndex: number): void {
    const slots = this.allRooms.get(key)
    if (slots) slots[instanceIndex] = null
  }
}
