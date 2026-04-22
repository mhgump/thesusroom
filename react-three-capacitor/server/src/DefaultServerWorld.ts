// Side-effect import registers the NPC type before the spec references it.
import './npc/entities/StillDamager.js'

import { DEFAULT_WALKABLE, ROOM3_CENTER_X, ROOM3_CENTER_Z, SOUTH_ROOM_CENTER_X, SOUTH_ROOM_CENTER_Z } from './WorldLayout.js'
import type { ServerWorldSpec } from './WorldManager.js'
import type { GameSpec } from './GameSpec.js'
import { DemoGameScript } from './scripts/DemoGameScript.js'

const DEMO_GAME_SPEC: GameSpec = {
  instructionSpecs: [
    { id: 'vote_instruction', text: 'Vote Yes or No' },
  ],
  voteRegions: [
    { id: 'vote_yes', label: 'Yes', color: '#2ecc71', x: SOUTH_ROOM_CENTER_X - 5, z: SOUTH_ROOM_CENTER_Z, radius: 3 },
    { id: 'vote_no',  label: 'No',  color: '#e74c3c', x: SOUTH_ROOM_CENTER_X + 5, z: SOUTH_ROOM_CENTER_Z, radius: 3 },
  ],
}

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
  gameSpec: DEMO_GAME_SPEC,
  gameScript: new DemoGameScript(),
}
