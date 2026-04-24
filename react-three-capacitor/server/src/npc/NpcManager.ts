import type { World, WorldEvent } from '../World.js'
import type { NpcSpec } from './NpcSpec.js'
import { createNpcEntity } from './NpcEntity.js'
import type { NpcEntity } from './NpcEntity.js'
import { buildNpcAbilities } from './NpcAbilities.js'
import type { NpcAbilityName } from './NpcAbilities.js'
import { buildNpcHelpers } from './NpcHelpers.js'
import type { NpcHelperName } from './NpcHelpers.js'

// Called by Room when a periodic NPC tick produces events or a position change.
type PeriodicBroadcast = (npcId: string, x: number, z: number, events: WorldEvent[]) => void

export class NpcManager {
  private readonly entities: Map<string, NpcEntity> = new Map()
  private readonly timers: Map<string, ReturnType<typeof setInterval>> = new Map()
  private readonly world: World
  private readonly periodicBroadcast: PeriodicBroadcast

  constructor(world: World, periodicBroadcast: PeriodicBroadcast) {
    this.world = world
    this.periodicBroadcast = periodicBroadcast
  }

  spawnAll(specs: NpcSpec[]): void {
    for (const spec of specs) this.spawn(spec)
  }

  spawn(spec: NpcSpec): void {
    const npcId = `npc:${spec.id}`
    this.world.addPlayer(npcId, spec.spawnX, spec.spawnZ)
    const entity = createNpcEntity(npcId, spec)
    this.entities.set(npcId, entity)

    if (typeof spec.trigger === 'object') {
      const timer = setInterval(() => {
        const emitted: WorldEvent[] = []
        this.runTick(entity, [], emitted)
        const np = this.world.getPlayer(entity.id)
        if (np && emitted.length > 0) {
          this.periodicBroadcast(entity.id, np.x, np.z, emitted)
        }
      }, spec.trigger.period)
      this.timers.set(npcId, timer)
    }
  }

  // Called after each player processMove. Returns extra events to append to that move's broadcast.
  onPlayerMove(triggerEvents: WorldEvent[]): WorldEvent[] {
    const extra: WorldEvent[] = []
    for (const entity of this.entities.values()) {
      if (entity.spec.trigger === 'on-player-move') {
        this.runTick(entity, triggerEvents, extra)
      }
    }
    return extra
  }

  // Returns entity id + spec for all spawned NPCs (used when sending initial state to new players).
  getNpcEntries(): Array<{ id: string; spec: NpcSpec }> {
    return [...this.entities.values()].map(e => ({ id: e.id, spec: e.spec }))
  }

  destroyAll(): void {
    for (const timer of this.timers.values()) clearInterval(timer)
    this.timers.clear()
    for (const id of this.entities.keys()) this.world.removePlayer(id)
    this.entities.clear()
  }

  private runTick(entity: NpcEntity, triggerEvents: WorldEvent[], out: WorldEvent[]): void {
    const allAbilities = buildNpcAbilities(this.world, entity.id)
    const allHelpers = buildNpcHelpers(this.world)

    // Enforce allowlists — only expose declared abilities and helpers.
    const abilities = Object.fromEntries(
      entity.spec.allowedAbilities
        .filter(k => k in allAbilities)
        .map(k => [k, allAbilities[k as NpcAbilityName]])
    ) as Partial<typeof allAbilities>

    const helpers = Object.fromEntries(
      entity.spec.allowedHelpers
        .filter(k => k in allHelpers)
        .map(k => [k, allHelpers[k as NpcHelperName]])
    ) as Partial<typeof allHelpers>

    entity.tick({
      npcId: entity.id,
      abilities,
      helpers,
      worldTime: Date.now(),
      triggerEvents,
      emitEvents: (evts) => out.push(...evts),
    })
  }
}
