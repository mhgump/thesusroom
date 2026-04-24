import type RAPIER_TYPE from '@dimforge/rapier2d-compat'
import { buildMapInstanceArtifacts } from './MapInstance.js'
import type { GameMap } from './GameMap.js'

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
  vx: number  // last frame movement delta
  vz: number
}

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

// ── Internal types ───────────────────────────────────────────────────────────

interface CharBody {
  body: RAPIER_TYPE.RigidBody
  collider: RAPIER_TYPE.Collider
}

// Global-coord AABB of a room's floor (for the stay-in-rooms constraint).
export interface RoomBounds { cx: number; cz: number; hw: number; hd: number }

// Global-coord 2D AABB of a single piece of geometry (the XZ projection Rapier
// uses for collision). Kept alongside the Rapier collider so `resolveOverlap`
// can compute push-out directions without re-querying Rapier.
interface GeometryCollider {
  cx: number; cz: number; hw: number; hd: number
  collider: RAPIER_TYPE.Collider
}

export interface MoveInput { jx: number; jz: number; dt: number }

// Per-map-instance record stored on the World. `addMap` populates this from a
// GameMap's WorldSpec; the default connections list supplies the initial
// adjacency (which may later be mutated by scenarios via setConnectionEnabled).
export interface WorldMapInstance {
  mapInstanceId: string
  scopedRoomIds: string[]
}

// ── World class ──────────────────────────────────────────────────────────────

export class World {
  readonly players: Map<string, WorldPlayerState> = new Map()
  private readonly playerRules: Map<string, string[]> = new Map()
  private readonly disabledEvents: Set<WorldEventType>
  private readonly touchingPairs: Set<string> = new Set()
  private moveQueue: Map<string, MoveInput[]> = new Map()

  // Registered map instances, keyed by mapInstanceId.
  private readonly mapInstances: Map<string, WorldMapInstance> = new Map()

  // Per-room world-space floor AABB, keyed by scoped room id. Populated by addMap.
  private readonly roomBounds: Map<string, RoomBounds> = new Map()

  // Current world-level adjacency (symmetric). Seeded from map connections;
  // scenarios mutate via setConnectionEnabled.
  private readonly connections: Map<string, Set<string>> = new Map()

  // Per-player scoped room id of the room the player is in, or null if
  // unresolved (not yet moved since spawn).
  private readonly playerRoom: Map<string, string | null> = new Map()

  // Per-player override of accessible rooms (scoped ids). When set, replaces
  // the default `{currentRoom} ∪ connections(currentRoom)` derivation.
  private readonly playerAccessibleRoomsOverride: Map<string, Set<string>> = new Map()

  // Rapier state. Required — initPhysics() must be awaited before `new World()`.
  private readonly rapier: RapierModule
  private readonly rapierWorld: RAPIER_TYPE.World
  private readonly controller: RAPIER_TYPE.KinematicCharacterController
  private readonly charBodies: Map<string, CharBody> = new Map()

  // Every geometry piece is a solid Rapier collider by default. Scenarios
  // toggle individual pieces off (passable) globally or per-player.
  private readonly geometries: Map<string, GeometryCollider> = new Map()
  private readonly geometryState: Map<string, boolean> = new Map()  // true=solid (default)
  private readonly playerGeomOverride: Map<string, Map<string, boolean>> = new Map()

  constructor(disabledEvents: WorldEventType[] = []) {
    if (!rapierModule) throw new Error('initPhysics() must be awaited before `new World()`')
    this.rapier = rapierModule
    this.rapierWorld = new this.rapier.World({ x: 0.0, y: 0.0 })
    this.controller = this.rapierWorld.createCharacterController(0.0)
    this.disabledEvents = new Set(disabledEvents)
  }

  // ── Map registration ───────────────────────────────────────────────────────

  // Register a map with this world: place rooms in world space from
  // connections, load the default adjacency, instantiate every geometry piece
  // as a Rapier collider in global coords.
  addMap(map: GameMap): WorldMapInstance {
    const { scopedRoomIds, roomBounds, geometry, adjacency } =
      buildMapInstanceArtifacts(map.worldSpec, map.mapInstanceId)

    for (const [scopedId, bounds] of roomBounds) {
      this.roomBounds.set(scopedId, bounds)
    }

    for (const [scopedId, neighbours] of adjacency) {
      const existing = this.connections.get(scopedId) ?? new Set<string>()
      for (const n of neighbours) existing.add(n)
      this.connections.set(scopedId, existing)
    }

    for (const g of geometry) {
      const body = this.rapierWorld.createRigidBody(this.rapier.RigidBodyDesc.fixed())
      const desc = this.rapier.ColliderDesc.cuboid(g.hw, g.hd).setTranslation(g.cx, g.cz)
      const collider = this.rapierWorld.createCollider(desc, body)
      this.geometries.set(g.id, { cx: g.cx, cz: g.cz, hw: g.hw, hd: g.hd, collider })
      this.geometryState.set(g.id, true)
    }

    this.rapierWorld.step()

    const instance: WorldMapInstance = { mapInstanceId: map.mapInstanceId, scopedRoomIds }
    this.mapInstances.set(map.mapInstanceId, instance)
    return instance
  }

  getMapInstance(mapInstanceId: string): WorldMapInstance | undefined {
    return this.mapInstances.get(mapInstanceId)
  }

  getRoomsInMapInstance(mapInstanceId: string): string[] {
    const instance = this.mapInstances.get(mapInstanceId)
    return instance ? [...instance.scopedRoomIds] : []
  }

  // ── Rooms & accessibility ──────────────────────────────────────────────────

  getPlayerRoom(playerId: string): string | null {
    return this.playerRoom.get(playerId) ?? null
  }

  setPlayerRoom(playerId: string, scopedRoomId: string | null): void {
    this.playerRoom.set(playerId, scopedRoomId)
  }

  // Enable or disable an adjacency link between two rooms. Symmetric.
  // Scenarios call this to open/close room-to-room traversal independently of
  // any physical barrier geometry (callers typically pair it with a matching
  // geometry toggle, but the two concerns are kept orthogonal on purpose).
  setConnectionEnabled(scopedRoomIdA: string, scopedRoomIdB: string, enabled: boolean): void {
    const getOrCreate = (id: string) => {
      let s = this.connections.get(id)
      if (!s) { s = new Set(); this.connections.set(id, s) }
      return s
    }
    if (enabled) {
      getOrCreate(scopedRoomIdA).add(scopedRoomIdB)
      getOrCreate(scopedRoomIdB).add(scopedRoomIdA)
    } else {
      this.connections.get(scopedRoomIdA)?.delete(scopedRoomIdB)
      this.connections.get(scopedRoomIdB)?.delete(scopedRoomIdA)
    }
  }

  isConnectionEnabled(scopedRoomIdA: string, scopedRoomIdB: string): boolean {
    return this.connections.get(scopedRoomIdA)?.has(scopedRoomIdB) ?? false
  }

  // The set of rooms a player may currently be in. Resolution order:
  //   1. per-player override, if set — used as-is
  //   2. else {currentRoom} ∪ enabled-connections(currentRoom)
  // If the player has no currentRoom yet, it is resolved from the player's
  // present position by looking up containing room AABBs.
  getAccessibleRooms(playerId: string): Set<string> {
    const override = this.playerAccessibleRoomsOverride.get(playerId)
    if (override) return new Set(override)

    const current = this.resolveCurrentRoom(playerId)
    if (!current) return new Set()
    const out = new Set<string>([current])
    for (const n of this.connections.get(current) ?? []) out.add(n)
    return out
  }

  setAccessibleRoomsOverride(playerId: string, scopedRoomIds: string[] | null): void {
    if (scopedRoomIds === null) this.playerAccessibleRoomsOverride.delete(playerId)
    else this.playerAccessibleRoomsOverride.set(playerId, new Set(scopedRoomIds))
  }

  // ── Geometry toggles ───────────────────────────────────────────────────────

  toggleGeometryOn(id: string, playerId?: string): void {
    if (playerId !== undefined) {
      let m = this.playerGeomOverride.get(playerId)
      if (!m) { m = new Map(); this.playerGeomOverride.set(playerId, m) }
      m.set(id, true)
      this.resolveOverlap(playerId, id)
    } else {
      this.geometryState.set(id, true)
      for (const pid of this.players.keys()) this.resolveOverlap(pid, id)
    }
  }

  toggleGeometryOff(id: string, playerId?: string): void {
    if (playerId !== undefined) {
      let m = this.playerGeomOverride.get(playerId)
      if (!m) { m = new Map(); this.playerGeomOverride.set(playerId, m) }
      m.set(id, false)
    } else {
      this.geometryState.set(id, false)
    }
  }

  // When a collider turns solid on top of a player, eject the player. Choose
  // the push direction by (a) the axis of minimum penetration and (b) the
  // player's recent velocity (fall back: reverse). The eject target must lie
  // inside one of the player's accessible rooms — otherwise the player is
  // pushed through the far face (or left in place if neither is valid).
  private resolveOverlap(playerId: string, geomId: string): void {
    const player = this.players.get(playerId)
    const geom = this.geometries.get(geomId)
    if (!player || !geom) return

    const ox = (geom.hw + CAPSULE_RADIUS) - Math.abs(player.x - geom.cx)
    const oz = (geom.hd + CAPSULE_RADIUS) - Math.abs(player.z - geom.cz)
    if (ox <= 0 || oz <= 0) return  // no overlap

    const clearNegX = geom.cx - geom.hw - CAPSULE_RADIUS
    const clearPosX = geom.cx + geom.hw + CAPSULE_RADIUS
    const clearNegZ = geom.cz - geom.hd - CAPSULE_RADIUS
    const clearPosZ = geom.cz + geom.hd + CAPSULE_RADIUS

    let primaryX = 0, primaryZ = 0, reverseX = 0, reverseZ = 0
    if (ox <= oz) {
      const goNeg = player.vx < 0 || (player.vx === 0 && player.x <= geom.cx)
      primaryX = (goNeg ? clearNegX : clearPosX) - player.x
      reverseX = (goNeg ? clearPosX : clearNegX) - player.x
    } else {
      const goNeg = player.vz < 0 || (player.vz === 0 && player.z <= geom.cz)
      primaryZ = (goNeg ? clearNegZ : clearPosZ) - player.z
      reverseZ = (goNeg ? clearPosZ : clearNegZ) - player.z
    }

    const allowed = this.getAccessibleRooms(playerId)
    const inAccessible = (nx: number, nz: number) => this.isInRoomSet(nx, nz, allowed)

    const candidates: Array<[number, number]> = [
      [player.x + primaryX, player.z + primaryZ],
      [player.x + reverseX, player.z + reverseZ],
    ]
    for (const [nx, nz] of candidates) {
      const remOx = (geom.hw + CAPSULE_RADIUS) - Math.abs(nx - geom.cx)
      const remOz = (geom.hd + CAPSULE_RADIUS) - Math.abs(nz - geom.cz)
      if (remOx > 0 && remOz > 0) continue  // still inside geometry
      if (!inAccessible(nx, nz)) continue
      this.setPlayerPosition(playerId, nx, nz)
      return
    }
    // No valid candidate — leave the player in place.
  }

  // ── Players ────────────────────────────────────────────────────────────────

  addPlayer(id: string, x = 0, z = 0): void {
    this.players.set(id, { id, x, z, animState: 'IDLE', hp: 2, vx: 0, vz: 0 })
    this.playerGeomOverride.set(id, new Map())
    const body = this.rapierWorld.createRigidBody(
      this.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(x, z),
    )
    const collider = this.rapierWorld.createCollider(
      this.rapier.ColliderDesc.ball(CAPSULE_RADIUS), body,
    )
    this.charBodies.set(id, { body, collider })
    this.rapierWorld.step()
  }

  removePlayer(id: string): void {
    this.players.delete(id)
    this.playerRules.delete(id)
    this.playerGeomOverride.delete(id)
    this.playerRoom.delete(id)
    this.playerAccessibleRoomsOverride.delete(id)
    for (const key of [...this.touchingPairs]) {
      const [a, b] = key.split(':')
      if (a === id || b === id) this.touchingPairs.delete(key)
    }
    const charData = this.charBodies.get(id)
    if (charData) {
      this.rapierWorld.removeRigidBody(charData.body)
      this.charBodies.delete(id)
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
    const charData = this.charBodies.get(id)
    if (charData) {
      charData.body.setNextKinematicTranslation({ x, y: z })
      this.rapierWorld.step()
    }
  }

  // ── Movement ───────────────────────────────────────────────────────────────

  processMove(playerId: string, jx: number, jz: number, dt: number): WorldEvent[] {
    const player = this.players.get(playerId)
    if (!player) return []

    const events: WorldEvent[] = []
    const safeDt = Math.min(dt, 0.1)
    const charData = this.charBodies.get(playerId)!

    const desired = { x: jx * MOVE_SPEED * safeDt, y: jz * MOVE_SPEED * safeDt }
    const playerOverride = this.playerGeomOverride.get(playerId)
    const passableHandles = new Set<number>()
    for (const [id, geom] of this.geometries) {
      const globalOn = this.geometryState.get(id) ?? true
      const effectiveOn = playerOverride?.has(id) ? playerOverride.get(id)! : globalOn
      if (!effectiveOn) passableHandles.add(geom.collider.handle)
    }
    for (const [id, other] of this.charBodies) {
      if (id !== playerId) passableHandles.add(other.collider.handle)
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
    const prevX = player.x
    const prevZ = player.z
    let nx = player.x + movement.x
    let nz = player.z + movement.y

    // Stay-in-rooms constraint: the post-move position must lie inside the
    // AABB union of the player's currently accessible rooms. If not, try
    // keeping only one axis, then fall back to full revert.
    const accessible = this.getAccessibleRooms(playerId)
    if (accessible.size > 0 && !this.isInRoomSet(nx, nz, accessible)) {
      if (this.isInRoomSet(nx, prevZ, accessible)) { nz = prevZ }
      else if (this.isInRoomSet(prevX, nz, accessible)) { nx = prevX }
      else { nx = prevX; nz = prevZ }
    }

    player.x = nx; player.z = nz
    player.vx = nx - prevX
    player.vz = nz - prevZ
    charData.body.setNextKinematicTranslation({ x: player.x, y: player.z })
    this.rapierWorld.step()

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

  // ── Private helpers ────────────────────────────────────────────────────────

  private resolveCurrentRoom(playerId: string): string | null {
    const stored = this.playerRoom.get(playerId)
    if (stored) return stored
    const p = this.players.get(playerId)
    if (!p) return null
    for (const [scopedId, b] of this.roomBounds) {
      if (Math.abs(p.x - b.cx) <= b.hw && Math.abs(p.z - b.cz) <= b.hd) return scopedId
    }
    return null
  }

  private isInRoomSet(x: number, z: number, rooms: Set<string>): boolean {
    for (const id of rooms) {
      const b = this.roomBounds.get(id)
      if (!b) continue
      if (Math.abs(x - b.cx) <= b.hw && Math.abs(z - b.cz) <= b.hd) return true
    }
    return false
  }
}
