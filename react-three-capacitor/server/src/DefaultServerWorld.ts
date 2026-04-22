// Side-effect import registers the NPC type before the spec references it.
import './npc/entities/StillDamager.js'

import { DEFAULT_WALKABLE, ROOM3_CENTER_X, ROOM3_CENTER_Z } from './WorldLayout.js'
import type { ServerWorldSpec } from './WorldManager.js'

export const DEFAULT_SERVER_WORLD: ServerWorldSpec = {
  worldId: 'default',
  walkable: DEFAULT_WALKABLE,
  npcs: [
    {
      id: 'room3-sentinel',
      type: 'still-damager',
      spawnX: ROOM3_CENTER_X,
      spawnZ: ROOM3_CENTER_Z,
      trigger: 'each-action',
      allowedActions: ['dealDamage'],
      allowedHelpers: ['getPosition', 'getPlayersInRange'],
      ux: { has_health: false },
    },
  ],
}
