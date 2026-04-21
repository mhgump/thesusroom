export type AnimationState = 'IDLE' | 'WALKING'
export type WorldEventType = 'update_animation_state' | 'touched'

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

export type WorldEvent = UpdateAnimationStateEvent | TouchedEvent

export interface WorldPlayerState {
  id: string
  x: number
  z: number
  animState: AnimationState
}

const MOVE_SPEED = 4
const ROOM_WIDTH = 20
const ROOM_DEPTH = 12
const CAPSULE_RADIUS = 0.35
const BOUND_X = ROOM_WIDTH / 2 - CAPSULE_RADIUS
const BOUND_Z = ROOM_DEPTH / 2 - CAPSULE_RADIUS
const ANIM_THRESHOLD = 0.05
const TOUCH_RADIUS = CAPSULE_RADIUS * 2 + 0.1

export class World {
  readonly players: Map<string, WorldPlayerState> = new Map()
  private readonly disabledEvents: Set<WorldEventType>
  private readonly touchingPairs: Set<string> = new Set()

  constructor(disabledEvents: WorldEventType[] = []) {
    this.disabledEvents = new Set(disabledEvents)
  }

  addPlayer(id: string, x = 0, z = 0): void {
    this.players.set(id, { id, x, z, animState: 'IDLE' })
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

  // Teleports a player; clears their touch pairs since position jumped.
  setPlayerPosition(id: string, x: number, z: number): void {
    const p = this.players.get(id)
    if (!p) return
    p.x = x
    p.z = z
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

    player.x = Math.max(-BOUND_X, Math.min(BOUND_X, player.x + jx * MOVE_SPEED * safeDt))
    player.z = Math.max(-BOUND_Z, Math.min(BOUND_Z, player.z + jz * MOVE_SPEED * safeDt))

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
        // Canonical pair key: smaller id first, so both players share the same key
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
}
