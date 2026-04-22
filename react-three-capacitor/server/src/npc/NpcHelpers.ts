import type { World } from '../World.js'

export type NpcHelperName = 'getPosition' | 'getPlayersInRange' | 'getDistanceTo' | 'getAllPlayerIds'

export interface NpcHelperFunctions {
  // World-space position of any entity (player or NPC) by id, or null if not found.
  getPosition: (entityId: string) => { x: number; z: number } | null
  // Ids of human players (not NPCs) whose capsule centre is within `range` of (x, z).
  getPlayersInRange: (x: number, z: number, range: number) => string[]
  // Euclidean distance between two entities, or null if either is not in the world.
  getDistanceTo: (fromId: string, toId: string) => number | null
  // All human player ids currently in the world (NPCs excluded).
  getAllPlayerIds: () => string[]
}

const NPC_PREFIX = 'npc:'

export function buildNpcHelpers(world: World): NpcHelperFunctions {
  return {
    getPosition: (entityId) => {
      const p = world.getPlayer(entityId)
      return p ? { x: p.x, z: p.z } : null
    },

    getPlayersInRange: (x, z, range) => {
      const result: string[] = []
      for (const [id, p] of world.players) {
        if (id.startsWith(NPC_PREFIX)) continue
        if (Math.hypot(p.x - x, p.z - z) <= range) result.push(id)
      }
      return result
    },

    getDistanceTo: (fromId, toId) => {
      const a = world.getPlayer(fromId)
      const b = world.getPlayer(toId)
      if (!a || !b) return null
      return Math.hypot(a.x - b.x, a.z - b.z)
    },

    getAllPlayerIds: () => {
      const ids: string[] = []
      for (const id of world.players.keys()) {
        if (!id.startsWith(NPC_PREFIX)) ids.push(id)
      }
      return ids
    },
  }
}
