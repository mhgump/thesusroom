import type { World, WorldEvent } from '../World.js'

export type NpcActionName = 'move' | 'setPosition' | 'dealDamage'

export interface NpcActionFunctions {
  // Process a movement step for the NPC — same physics as a player move.
  move: (jx: number, jz: number, dt: number) => WorldEvent[]
  // Teleport the NPC to an exact position (clears touch pairs).
  setPosition: (x: number, z: number) => void
  // Apply `amount` HP damage to target. Returns a DamageEvent if HP changed.
  dealDamage: (targetId: string, amount: number) => WorldEvent[]
}

export function buildNpcActions(world: World, npcId: string): NpcActionFunctions {
  return {
    move: (jx, jz, dt) => world.processMove(npcId, jx, jz, dt),
    setPosition: (x, z) => world.setPlayerPosition(npcId, x, z),
    dealDamage: (targetId, amount) => {
      const evt = world.applyDamage(targetId, amount)
      return evt ? [evt] : []
    },
  }
}
