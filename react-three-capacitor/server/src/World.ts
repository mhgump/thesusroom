export type AnimationState = 'IDLE' | 'WALKING'
export type WorldEventType = 'update_animation_state' | 'touched' | 'damage'

export interface UpdateAnimationStateEvent {
  type: 'update_animation_state'
  playerId: string
  animState: AnimationState
}

export interface TouchedEvent {
  type: 'touched'
  playerIdA: string
  playerIdB: string
}

export interface DamageEvent {
  type: 'damage'
  targetId: string
  newHp: 0 | 1 | 2
}

export type WorldEvent = UpdateAnimationStateEvent | TouchedEvent | DamageEvent

export interface WorldPlayerState {
  id: string
  x: number
  z: number
  animState: AnimationState
  hp: 0 | 1 | 2
}

// Walkable area — defined here so server/src stays self-contained.
export interface WalkableRect { cx: number; cz: number; hw: number; hd: number }
export interface WalkableArea { rects: WalkableRect[] }

const MOVE_SPEED = 8        // must match src/game/World.ts
const CAPSULE_RADIUS = 0.35 // must match src/game/World.ts
const ANIM_THRESHOLD = 0.05
const TOUCH_RADIUS = CAPSULE_RADIUS * 2 + 0.1

export class World {
  readonly players: Map<string, WorldPlayerState> = new Map()
  private readonly disabledEvents: Set<WorldEventType>
  private readonly touchingPairs: Set<string> = new Set()
  private readonly walkable: WalkableArea

  constructor(walkable: WalkableArea, disabledEvents: WorldEventType[] = []) {
    this.walkable = walkable
    this.disabledEvents = new Set(disabledEvents)
  }

  addPlayer(id: string, x = 0, z = 0): void {
    this.players.set(id, { id, x, z, animState: 'IDLE', hp: 2 })
  }

  removePlayer(id: string): void {
    this.players.delete(id)
    for (const key of [...this.touchingPairs]) {
      const [a, b] = key.split(':')
      if (a === id || b === id) this.touchingPairs.delete(key)
    }
  }

  getPlayer(id: string): WorldPlayerState | undefined {
    return this.players.get(id)
  }

  setPlayerPosition(id: string, x: number, z: number): void {
    const p = this.players.get(id)
    if (!p) return
    p.x = x; p.z = z
    for (const key of [...this.touchingPairs]) {
      const [a, b] = key.split(':')
      if (a === id || b === id) this.touchingPairs.delete(key)
    }
  }

  processMove(playerId: string, jx: number, jz: number, dt: number): WorldEvent[] {
    const player = this.players.get(playerId)
    if (!player) return []

    const events: WorldEvent[] = []
    const safeDt = Math.min(dt, 0.1)

    const nx = player.x + jx * MOVE_SPEED * safeDt
    const nz = player.z + jz * MOVE_SPEED * safeDt

    if (this.inWalkable(nx, nz)) {
      player.x = nx; player.z = nz
    } else if (this.inWalkable(nx, player.z)) {
      player.x = nx
    } else if (this.inWalkable(player.x, nz)) {
      player.z = nz
    }

    const newAnimState: AnimationState = Math.hypot(jx, jz) > ANIM_THRESHOLD ? 'WALKING' : 'IDLE'
    if (newAnimState !== player.animState) {
      player.animState = newAnimState
      if (!this.disabledEvents.has('update_animation_state')) {
        events.push({ type: 'update_animation_state', playerId, animState: newAnimState })
      }
    }

    if (!this.disabledEvents.has('touched')) {
      for (const [otherId, other] of this.players) {
        if (otherId === playerId) continue
        const a = playerId < otherId ? playerId : otherId
        const b = playerId < otherId ? otherId : playerId
        const pairKey = `${a}:${b}`
        const nowTouching = Math.hypot(player.x - other.x, player.z - other.z) < TOUCH_RADIUS
        const wasTouching = this.touchingPairs.has(pairKey)
        if (nowTouching && !wasTouching) {
          this.touchingPairs.add(pairKey)
          events.push({ type: 'touched', playerIdA: playerId, playerIdB: otherId })
        } else if (!nowTouching && wasTouching) {
          this.touchingPairs.delete(pairKey)
        }
      }
    }

    return events
  }

  applyDamage(targetId: string, amount: number): DamageEvent | null {
    const p = this.players.get(targetId)
    if (!p) return null
    const raw = p.hp - amount
    const newHp = (raw <= 0 ? 0 : raw >= 2 ? 2 : raw) as 0 | 1 | 2
    if (newHp === p.hp) return null
    p.hp = newHp
    return { type: 'damage', targetId, newHp }
  }

  private inWalkable(x: number, z: number): boolean {
    for (const r of this.walkable.rects) {
      if (Math.abs(x - r.cx) <= r.hw && Math.abs(z - r.cz) <= r.hd) return true
    }
    return false
  }
}
