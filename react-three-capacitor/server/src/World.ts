import type RAPIER_TYPE from '@dimforge/rapier2d-compat'

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

// Walkable area — used in AABB fallback mode and for snap logic.
export interface WalkableRect { cx: number; cz: number; hw: number; hd: number }
export interface WalkableArea { rects: WalkableRect[] }

// Rapier physics geometry — when provided, replaces AABB collision.
export interface PhysicsWall { cx: number; cz: number; hw: number; hd: number }
export interface PhysicsDoor { id: string; cx: number; cz: number; hw: number; hd: number }
export interface PhysicsSpec { walls: PhysicsWall[]; doors: PhysicsDoor[] }

const MOVE_SPEED = 0.645    // must match src/game/World.ts
const CAPSULE_RADIUS = 0.0282 // must match src/game/World.ts
const ANIM_THRESHOLD = 0.05
const TOUCH_RADIUS = CAPSULE_RADIUS * 2 + 0.0081

// ── Rapier singleton ─────────────────────────────────────────────────────────

type RapierModule = typeof RAPIER_TYPE
let rapierModule: RapierModule | null = null

export async function initPhysics(): Promise<void> {
  if (rapierModule) return
  const mod = await import('@dimforge/rapier2d-compat')
  await mod.default.init()
  rapierModule = mod.default
}

// ── World class ──────────────────────────────────────────────────────────────

interface CharBody {
  body: RAPIER_TYPE.RigidBody
  collider: RAPIER_TYPE.Collider
}

export class World {
  readonly players: Map<string, WorldPlayerState> = new Map()
  private readonly disabledEvents: Set<WorldEventType>
  private readonly touchingPairs: Set<string> = new Set()
  private walkable: WalkableArea

  // Rapier state (null = AABB mode)
  private rapier: RapierModule | null = null
  private rapierWorld: RAPIER_TYPE.World | null = null
  private controller: RAPIER_TYPE.KinematicCharacterController | null = null
  private charBodies: Map<string, CharBody> = new Map()
  private doorColliders: Map<string, RAPIER_TYPE.Collider> = new Map()
  private globalOpenDoors: Set<string> = new Set()
  private playerBlockedDoors: Map<string, Set<string>> = new Map()

  constructor(walkable: WalkableArea, disabledEvents: WorldEventType[] = []) {
    this.walkable = walkable
    this.disabledEvents = new Set(disabledEvents)
  }

  // Factory: construct a World backed by Rapier physics.
  // initPhysics() must have been awaited before calling this.
  static withPhysics(walkable: WalkableArea, physics: PhysicsSpec, disabledEvents: WorldEventType[] = []): World {
    if (!rapierModule) throw new Error('initPhysics() must be awaited before World.withPhysics()')
    const w = new World(walkable, disabledEvents)
    w.rapier = rapierModule
    w.buildRapierWorld(physics)
    return w
  }

  private buildRapierWorld(physics: PhysicsSpec): void {
    const R = this.rapier!
    this.rapierWorld = new R.World({ x: 0.0, y: 0.0 })

    for (const wall of physics.walls) {
      const body = this.rapierWorld.createRigidBody(R.RigidBodyDesc.fixed())
      const desc = R.ColliderDesc.cuboid(wall.hw, wall.hd).setTranslation(wall.cx, wall.cz)
      this.rapierWorld.createCollider(desc, body)
    }

    for (const door of physics.doors) {
      const body = this.rapierWorld.createRigidBody(R.RigidBodyDesc.fixed())
      const desc = R.ColliderDesc.cuboid(door.hw, door.hd).setTranslation(door.cx, door.cz)
      const collider = this.rapierWorld.createCollider(desc, body)
      this.doorColliders.set(door.id, collider)
    }

    this.controller = this.rapierWorld.createCharacterController(0.0)
    this.rapierWorld.step()
  }

  openDoor(doorId: string): void { this.globalOpenDoors.add(doorId) }
  closeDoor(doorId: string): void { this.globalOpenDoors.delete(doorId) }
  closeDoorForPlayer(playerId: string, doorId: string): void {
    if (!this.playerBlockedDoors.has(playerId)) this.playerBlockedDoors.set(playerId, new Set())
    this.playerBlockedDoors.get(playerId)!.add(doorId)
  }

  setWalkable(area: WalkableArea): void {
    this.walkable = area
    // In Rapier mode the walkable area is only used for snap; physics is handled by colliders.
  }

  snapAllPlayers(): void {
    if (this.rapierWorld) return // Rapier enforces bounds continuously; no snap needed.
    for (const p of this.players.values()) {
      if (this.inWalkable(p.x, p.z)) continue
      let bestX = p.x, bestZ = p.z, bestDist = Infinity
      for (const r of this.walkable.rects) {
        const cx = Math.max(r.cx - r.hw, Math.min(r.cx + r.hw, p.x))
        const cz = Math.max(r.cz - r.hd, Math.min(r.cz + r.hd, p.z))
        const dist = Math.hypot(p.x - cx, p.z - cz)
        if (dist < bestDist) { bestDist = dist; bestX = cx; bestZ = cz }
      }
      p.x = bestX; p.z = bestZ
    }
  }

  addPlayer(id: string, x = 0, z = 0): void {
    this.players.set(id, { id, x, z, animState: 'IDLE', hp: 2 })
    this.playerBlockedDoors.set(id, new Set())
    if (this.rapierWorld && this.rapier) {
      const R = this.rapier
      const body = this.rapierWorld.createRigidBody(
        R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, z)
      )
      const collider = this.rapierWorld.createCollider(R.ColliderDesc.ball(CAPSULE_RADIUS), body)
      this.charBodies.set(id, { body, collider })
      this.rapierWorld.step()
    }
  }

  removePlayer(id: string): void {
    this.players.delete(id)
    this.playerBlockedDoors.delete(id)
    for (const key of [...this.touchingPairs]) {
      const [a, b] = key.split(':')
      if (a === id || b === id) this.touchingPairs.delete(key)
    }
    if (this.rapierWorld) {
      const charData = this.charBodies.get(id)
      if (charData) {
        this.rapierWorld.removeRigidBody(charData.body)
        this.charBodies.delete(id)
      }
    }
  }

  getPlayer(id: string): WorldPlayerState | undefined { return this.players.get(id) }

  setPlayerPosition(id: string, x: number, z: number): void {
    const p = this.players.get(id)
    if (!p) return
    p.x = x; p.z = z
    for (const key of [...this.touchingPairs]) {
      const [a, b] = key.split(':')
      if (a === id || b === id) this.touchingPairs.delete(key)
    }
    if (this.rapierWorld) {
      const charData = this.charBodies.get(id)
      if (charData) {
        charData.body.setNextKinematicTranslation({ x, y: z })
        this.rapierWorld.step()
      }
    }
  }

  processMove(playerId: string, jx: number, jz: number, dt: number): WorldEvent[] {
    const player = this.players.get(playerId)
    if (!player) return []

    const events: WorldEvent[] = []
    const safeDt = Math.min(dt, 0.1)

    if (this.rapierWorld && this.controller) {
      const charData = this.charBodies.get(playerId)!
      const desired = { x: jx * MOVE_SPEED * safeDt, y: jz * MOVE_SPEED * safeDt }

      const playerBlocked = this.playerBlockedDoors.get(playerId) ?? new Set<string>()
      const disabledHandles = new Set(
        [...this.globalOpenDoors]
          .filter(id => !playerBlocked.has(id))
          .map(id => this.doorColliders.get(id))
          .filter((c): c is RAPIER_TYPE.Collider => c !== undefined)
          .map(c => c.handle)
      )

      this.controller.computeColliderMovement(
        charData.collider,
        desired,
        undefined,
        undefined,
        (collider: RAPIER_TYPE.Collider) => {
          if (collider.handle === charData.collider.handle) return false
          const parent = collider.parent()
          if (parent && parent.isKinematic()) return false
          if (disabledHandles.has(collider.handle)) return false
          return true
        },
      )

      const movement = this.controller.computedMovement()
      player.x += movement.x
      player.z += movement.y
      charData.body.setNextKinematicTranslation({ x: player.x, y: player.z })
      this.rapierWorld.step()
    } else {
      // AABB fallback
      const nx = player.x + jx * MOVE_SPEED * safeDt
      const nz = player.z + jz * MOVE_SPEED * safeDt
      if (this.inWalkable(nx, nz)) {
        player.x = nx; player.z = nz
      } else if (this.inWalkable(nx, player.z)) {
        player.x = nx
      } else if (this.inWalkable(player.x, nz)) {
        player.z = nz
      }
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
