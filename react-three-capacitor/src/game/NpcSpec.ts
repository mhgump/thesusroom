export type NpcTrigger = 'each-action' | { period: number }

export interface NpcUxFlags {
  has_health: boolean
}

export interface NpcSpec {
  id: string
  type: string
  spawnX: number
  spawnZ: number
  trigger: NpcTrigger
  allowedActions: readonly string[]
  allowedHelpers: readonly string[]
  ux: NpcUxFlags
  config?: unknown
}
