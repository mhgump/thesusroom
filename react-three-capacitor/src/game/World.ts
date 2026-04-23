import type RAPIER_TYPE from '@dimforge/rapier2d-compat'
import type { WalkableArea, WalkableRect } from './WorldSpec.js'

export type { WalkableArea, WalkableRect } from './WorldSpec.js'

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
  vx: number  // last frame movement delta, used to disambiguate push-out direction
  vz: number
}

// Rapier physics geometry — when provided, replaces AABB collision.
export interface PhysicsWall { cx: number; cz: number; hw: number; hd: number }
export interface PhysicsGeometry { id: string; cx: number; cz: number; hw: number; hd: number }
export interface PhysicsSpec { walls: PhysicsWall[]; geometry: PhysicsGeometry[] }

export const TICK_RATE_HZ = 20

const MOVE_SPEED = 0.645
const CAPSULE_RADIUS = 0.0282
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

export interface MoveInput { jx: number; jz: number; dt: number }

export class World {
  readonly players: Map<string, WorldPlayerState> = new Map()
  private readonly playerRules: Map<string, string[]> = new Map()
  private readonly disabledEvents: Set<WorldEventType>
  private readonly touchingPairs: Set<string> = new Set()
  private walkable: WalkableArea
  private moveQueue: Map<string, MoveInput[]> = new Map()

  // Rapier state (null = AABB mode)
  private rapier: RapierModule | null = null
  private rapierWorld: RAPIER_TYPE.World | null = null
  private controller: RAPIER_TYPE.KinematicCharacterController | null = null
  private charBodies: Map<string, CharBody> = new Map()
  private toggleColliders: Map<string, RAPIER_TYPE.Collider> = new Map()
  private physicsGeomSpecs: Map<string, PhysicsGeometry> = new Map()
  private geometryState: Map<string, boolean> = new Map() // true=on/solid (default), false=off/passable
  private playerGeomOverride: Map<string, Map<string, boolean>> = new Map()
  private playerRoomLock: Map<string, WalkableRect[]> = new Map()

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

    for (const geom of physics.geometry) {
      const body = this.rapierWorld.createRigidBody(R.RigidBodyDesc.fixed())
      const desc = R.ColliderDesc.cuboid(geom.hw, geom.hd).setTranslation(geom.cx, geom.cz)
      const collider = this.rapierWorld.createCollider(desc, body)
      this.toggleColliders.set(geom.id, collider)
      this.physicsGeomSpecs.set(geom.id, geom)
    }

    this.controller = this.rapierWorld.createCharacterController(0.0)
    this.rapierWorld.step()
  }

  toggleGeometryOn(id: string, playerId?: string): void {
    if (playerId !== undefined) {
      if (!this.playerGeomOverride.has(playerId)) this.playerGeomOverride.set(playerId, new Map())
      this.playerGeomOverride.get(playerId)!.set(id, true)
      this.resolveOverlap(playerId, id)
    } else {
      this.geometryState.set(id, true)
      for (const pid of this.players.keys()) this.resolveOverlap(pid, id)
    }
  }

  toggleGeometryOff(id: string, playerId?: string): void {
    if (playerId !== undefined) {
      if (!this.playerGeomOverride.has(playerId)) this.playerGeomOverride.set(playerId, new Map())
      this.playerGeomOverride.get(playerId)!.set(id, false)
    } else {
      this.geometryState.set(id, false)
    }
  }

  // When geometry turns solid, eject any player overlapping it.
  // Direction: velocity-based on the minimum-penetration axis (reverse as fallback).
  // If the player has a room lock (set via lockCurrentRoom before the toggle), the pushed
  // position must be within the locked rect — this prevents ejection into the wrong room.
  private resolveOverlap(playerId: string, geomId: string): void {
    const player = this.players.get(playerId)
    const spec = this.physicsGeomSpecs.get(geomId)
    if (!player || !spec) return

    const ox = (spec.hw + CAPSULE_RADIUS) - Math.abs(player.x - spec.cx)
    const oz = (spec.hd + CAPSULE_RADIUS) - Math.abs(player.z - spec.cz)
    if (ox <= 0 || oz <= 0) return  // no overlap

    // Clear positions: player center just outside each face of the collider.
    const clearNegX = spec.cx - spec.hw - CAPSULE_RADIUS
    const clearPosX = spec.cx + spec.hw + CAPSULE_RADIUS
    const clearNegZ = spec.cz - spec.hd - CAPSULE_RADIUS
    const clearPosZ = spec.cz + spec.hd + CAPSULE_RADIUS

    let primaryX = 0, primaryZ = 0, reverseX = 0, reverseZ = 0
    if (ox <= oz) {
      const goNeg = player.vx < 0 || (player.vx === 0 && player.x <= spec.cx)
      primaryX = (goNeg ? clearNegX : clearPosX) - player.x
      reverseX = (goNeg ? clearPosX : clearNegX) - player.x
    } else {
      const goNeg = player.vz < 0 || (player.vz === 0 && player.z <= spec.cz)
      primaryZ = (goNeg ? clearNegZ : clearPosZ) - player.z
      reverseZ = (goNeg ? clearPosZ : clearNegZ) - player.z
    }

    const lock = this.playerRoomLock.get(playerId)
    const isValid = (nx: number, nz: number): boolean => {
      const remOx = (spec.hw + CAPSULE_RADIUS) - Math.abs(nx - spec.cx)
      const remOz = (spec.hd + CAPSULE_RADIUS) - Math.abs(nz - spec.cz)
      if (remOx > 0 && remOz > 0) return false  // still inside geometry
      if (lock) return lock.some(r => Math.abs(nx - r.cx) <= r.hw && Math.abs(nz - r.cz) <= r.hd)
      return true  // no lock: any position outside geometry is fine; Rapier enforces walls
    }

    const candidates: Array<[number, number]> = [
      [player.x + primaryX, player.z + primaryZ],
      [player.x + reverseX, player.z + reverseZ],
    ]

    for (const [nx, nz] of candidates) {
      if (isValid(nx, nz)) {
        this.setPlayerPosition(playerId, nx, nz)
        return
      }
    }
    // All candidates failed — leave player in place.
  }

  setWalkable(area: WalkableArea): void { this.walkable = area }

  // Lock a player to whichever walkable rect they're currently deepest inside.
  // resolveOverlap will only accept push targets within that rect, preventing
  // a closing geometry from ejecting the player into the wrong room.
  lockCurrentRoom(playerId: string): void {
    const p = this.players.get(playerId)
    if (!p) return
    let homeRect: WalkableRect | null = null
    let homeDepth = -Infinity
    for (const r of this.walkable.rects) {
      const dx = r.hw - Math.abs(p.x - r.cx)
      const dz = r.hd - Math.abs(p.z - r.cz)
      if (dx < 0 || dz < 0) continue
      const depth = Math.min(dx, dz)
      if (depth > homeDepth) { homeDepth = depth; homeRect = r }
    }
    if (homeRect) this.playerRoomLock.set(playerId, [homeRect])
  }

  unlockPlayerFromRoom(playerId: string): void {
    this.playerRoomLock.delete(playerId)
  }

  snapAllPlayers(): void {
    if (this.rapierWorld) return // Rapier enforces bounds continuously.
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
    this.players.set(id, { id, x, z, animState: 'IDLE', hp: 2, vx: 0, vz: 0 })
    this.playerGeomOverride.set(id, new Map())
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
    this.playerRules.delete(id)
    this.playerGeomOverride.delete(id)
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

  addPlayerRule(id: string, text: string): void {
    const rules = this.playerRules.get(id)
    if (rules) rules.push(text)
    else this.playerRules.set(id, [text])
  }

  getPlayerRules(id: string): string[] { return this.playerRules.get(id) ?? [] }

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

      const playerOverride = this.playerGeomOverride.get(playerId)
      const passableHandles = new Set<number>()
      for (const [id, collider] of this.toggleColliders) {
        const globalOn = this.geometryState.get(id) ?? true
        const effectiveOn = playerOverride?.has(id) ? playerOverride.get(id)! : globalOn
        if (!effectiveOn) passableHandles.add(collider.handle)
      }
      for (const [id, charBody] of this.charBodies) {
        if (id !== playerId) passableHandles.add(charBody.collider.handle)
      }

      this.controller.computeColliderMovement(
        charData.collider,
        desired,
        undefined,
        undefined,
        (collider: RAPIER_TYPE.Collider) => {
          if (collider.handle === charData.collider.handle) return false
          if (passableHandles.has(collider.handle)) return false
          return true
        },
      )

      const movement = this.controller.computedMovement()
      player.x += movement.x
      player.z += movement.y
      player.vx = movement.x
      player.vz = movement.y
      charData.body.setNextKinematicTranslation({ x: player.x, y: player.z })
      this.rapierWorld.step()
    } else {
      const prevX = player.x
      const prevZ = player.z
      const nx = player.x + jx * MOVE_SPEED * safeDt
      const nz = player.z + jz * MOVE_SPEED * safeDt
      if (this.inWalkable(nx, nz)) {
        player.x = nx; player.z = nz
      } else if (this.inWalkable(nx, player.z)) {
        player.x = nx
      } else if (this.inWalkable(player.x, nz)) {
        player.z = nz
      }
      player.vx = player.x - prevX
      player.vz = player.z - prevZ
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

  queueMove(playerId: string, inputs: MoveInput[]): void {
    this.moveQueue.set(playerId, inputs)
  }

  processTick(): Map<string, WorldEvent[]> {
    const result = new Map<string, WorldEvent[]>()
    for (const [playerId, inputs] of this.moveQueue) {
      const events: WorldEvent[] = []
      for (const { jx, jz, dt } of inputs) {
        events.push(...this.processMove(playerId, jx, jz, dt))
      }
      result.set(playerId, events)
    }
    this.moveQueue.clear()
    return result
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
