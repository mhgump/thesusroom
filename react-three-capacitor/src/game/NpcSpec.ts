export type NpcTrigger = 'on-player-move' | { period: number }

export interface NpcUxFlags {
  has_health: boolean
}

export interface NpcSpec {
  id: string
  type: string
  spawnX: number
  spawnZ: number
  trigger: NpcTrigger
  allowedAbilities: readonly string[]
  allowedHelpers: readonly string[]
  ux: NpcUxFlags
  config?: unknown
}
