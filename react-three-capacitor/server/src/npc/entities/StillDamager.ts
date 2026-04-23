import { registerNpcType } from '../NpcEntity.js'
import type { NpcEntity, NpcContext } from '../NpcEntity.js'
import type { NpcSpec } from '../NpcSpec.js'

// TOUCH_RADIUS must match World.ts: CAPSULE_RADIUS * 2 + 0.0081
const TOUCH_RADIUS = 0.0282 * 2 + 0.0081

// Stands still at spawn. Deals 1 damage to any player on first contact.
// Damage re-arms per player once they leave touch range.
class StillDamagerEntity implements NpcEntity {
  readonly id: string
  readonly spec: NpcSpec
  private readonly hitThisContact = new Set<string>()

  constructor(id: string, spec: NpcSpec) {
    this.id = id
    this.spec = spec
  }

  tick(ctx: NpcContext): void {
    // Damage on first touch contact
    for (const evt of ctx.triggerEvents) {
      if (evt.type !== 'touched') continue
      if (evt.playerIdA !== this.id && evt.playerIdB !== this.id) continue
      const targetId = evt.playerIdA === this.id ? evt.playerIdB : evt.playerIdA
      if (!targetId || targetId === this.id) continue
      if (this.hitThisContact.has(targetId)) continue
      this.hitThisContact.add(targetId)
      ctx.emitEvents(ctx.actions.dealDamage!(targetId, 1))
    }

    // Re-arm when players step out of range
    const myPos = ctx.helpers.getPosition!(this.id)
    if (!myPos) return
    const nearby = new Set(ctx.helpers.getPlayersInRange!(myPos.x, myPos.z, TOUCH_RADIUS))
    for (const pid of this.hitThisContact) {
      if (!nearby.has(pid)) this.hitThisContact.delete(pid)
    }
  }
}

registerNpcType('still-damager', (id, spec) => new StillDamagerEntity(id, spec))
