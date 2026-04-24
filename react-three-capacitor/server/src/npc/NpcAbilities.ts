import type { World, WorldEvent } from '../World.js'

export type NpcAbilityName = 'move' | 'setPosition' | 'dealDamage'

export interface NpcAbilityFunctions {
  move: (jx: number, jz: number, dt: number) => WorldEvent[]
  setPosition: (x: number, z: number) => void
  dealDamage: (targetId: string, amount: number) => WorldEvent[]
}

export function buildNpcAbilities(world: World, npcId: string): NpcAbilityFunctions {
  return {
    move: (jx, jz, dt) => world.processMove(npcId, jx, jz, dt),
    setPosition: (x, z) => world.setPlayerPosition(npcId, x, z),
    dealDamage: (targetId, amount) => {
      const evt = world.applyDamage(targetId, amount)
      return evt ? [evt] : []
    },
  }
}
