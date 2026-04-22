// NPC specification types — define what an NPC is and what it can access.

// 'each-action': fires after every player processMove completes.
// { period: number }: fires every `period` ms of server wall-clock time.
export type NpcTrigger = 'each-action' | { period: number }

export interface NpcUxFlags {
  // If false, no HP bar renders for this NPC on the client.
  has_health: boolean
}

export interface NpcSpec {
  // Unique id within the world. The world-scoped NPC entity id is `npc:<id>`.
  id: string
  // Registered NPC type name (must be registered via registerNpcType).
  type: string
  spawnX: number
  spawnZ: number
  trigger: NpcTrigger
  // Explicit allowlist of action keys this NPC type may call.
  allowedActions: readonly string[]
  // Explicit allowlist of helper keys this NPC type may query.
  allowedHelpers: readonly string[]
  ux: NpcUxFlags
  // Optional type-specific configuration passed to the entity at construction.
  config?: unknown
}
