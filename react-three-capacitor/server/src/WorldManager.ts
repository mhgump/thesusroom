import type { WalkableArea } from './World.js'
import type { NpcSpec } from './npc/NpcSpec.js'
import type { GameSpec } from './GameSpec.js'
import type { GameScript } from './GameScript.js'
import { Room } from './Room.js'

// Server-side world definition. One world = one Room = one WebSocket room.
export interface ServerWorldSpec {
  worldId: string
  walkable: WalkableArea
  npcs: NpcSpec[]
  gameSpec?: GameSpec
  gameScript?: GameScript
}

export class WorldManager {
  private readonly worlds: Map<string, Room> = new Map()
  private readonly defaultWorldId: string

  constructor(specs: ServerWorldSpec[]) {
    for (const spec of specs) {
      this.worlds.set(spec.worldId, new Room(spec.worldId, spec.walkable, spec.npcs, spec.gameSpec, spec.gameScript))
    }
    this.defaultWorldId = specs[0]?.worldId ?? ''
  }

  // Decides which world a new player should join.
  // Current policy: all players go to the first/default world.
  assignPlayer(_playerId: string): string {
    return this.defaultWorldId
  }

  getRoom(worldId: string): Room | undefined {
    return this.worlds.get(worldId)
  }
}
