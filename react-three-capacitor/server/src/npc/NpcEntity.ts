import type { WorldEvent } from '../World.js'
import type { NpcSpec } from './NpcSpec.js'
import type { NpcAbilityFunctions } from './NpcAbilities.js'
import type { NpcHelperFunctions } from './NpcHelpers.js'

// Context object injected into every NPC tick call.
// `abilities` and `helpers` are pre-filtered to the entity's declared allowlists.
export interface NpcContext {
  npcId: string
  abilities: Readonly<Partial<NpcAbilityFunctions>>
  helpers: Readonly<Partial<NpcHelperFunctions>>
  // Server wall-clock time at tick invocation (ms).
  worldTime: number
  // World events produced by the player move that triggered this tick.
  // Empty for periodic triggers.
  triggerEvents: readonly WorldEvent[]
  // Push events to be broadcast to all clients as part of this tick's result.
  emitEvents: (events: WorldEvent[]) => void
}

export interface NpcEntity {
  readonly id: string
  readonly spec: NpcSpec
  tick(ctx: NpcContext): void
}

type NpcEntityFactory = (id: string, spec: NpcSpec) => NpcEntity

const registry = new Map<string, NpcEntityFactory>()

export function registerNpcType(typeName: string, factory: NpcEntityFactory): void {
  registry.set(typeName, factory)
}

export function createNpcEntity(id: string, spec: NpcSpec): NpcEntity {
  const factory = registry.get(spec.type)
  if (!factory) throw new Error(`Unknown NPC type: "${spec.type}"`)
  return factory(id, spec)
}
