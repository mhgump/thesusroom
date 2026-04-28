import type RAPIER_TYPE from '@dimforge/rapier2d-compat'
import type { FlattenedGeometry } from './MapInstance.js'
import type { RoomManager } from './RoomManager.js'

type RapierModule = typeof RAPIER_TYPE

// ── Internal types ───────────────────────────────────────────────────────────

interface CharBody {
  body: RAPIER_TYPE.RigidBody
  collider: RAPIER_TYPE.Collider
}

// Global-coord 2D AABB of a single piece of geometry (the XZ projection Rapier
// uses for collision). Kept alongside the Rapier collider so `resolveOverlap`
// can compute push-out directions without re-querying Rapier.
interface GeometryCollider {
  cx: number; cz: number; hw: number; hd: number
  collider: RAPIER_TYPE.Collider
}

// Player-position interface needed to drive Rapier kinematic bodies and to do
// overlap resolution. Physics doesn't own player records (Scene does), so we
// take a callback to read/write the live (x, z).
export interface PhysicsPlayerAccessor {
  getPlayer(playerId: string): { x: number; z: number; vx: number; vz: number } | undefined
  setPlayerPosition(playerId: string, x: number, z: number): void
}

// Capsule radius for the player character body. Mirrors the legacy World
// constant so behavior is identical.
export const CAPSULE_RADIUS = 0.0282

// Result of `processMove`. Returns the resolved post-collision position; the
// caller (Scene) is responsible for writing it back into the player record
// and emitting downstream events (touched / animation / etc.).
export interface ProcessMoveResult {
  x: number
  z: number
}

// ── Physics class ────────────────────────────────────────────────────────────

// Owns Rapier state and physics-only logic. All Rapier types stay behind this
// class so the rest of the codebase never imports `@dimforge/rapier2d-compat`
// directly. Constructed with a pre-initialized rapier module — caller awaits
// `initPhysics()` before `new Physics(rapier)`.
//
// Collision-vs-visibility split: this class ONLY handles collision. It exposes
// `toggleEntityCollisionsOn/Off` for the Rapier passability flag. Visibility
// of geometry is owned by `Scene` (which holds `globalEntityVisible` and
// `playerEntityVisible`). The two layers are composed when picking which
// colliders are passable for a given player's `processMove` — see the
// `passabilityResolver` callback.
export class Physics {
  private readonly rapier: RapierModule
  private readonly rapierWorld: RAPIER_TYPE.World
  private readonly controller: RAPIER_TYPE.KinematicCharacterController
  private readonly charBodies: Map<string, CharBody> = new Map()

  // Geometry collider state. Every geometry piece is solid by default;
  // scenarios can flip individual pieces to passable globally or per-player.
  private readonly geometries: Map<string, GeometryCollider> = new Map()
  private readonly geometryState: Map<string, boolean> = new Map() // true=solid (default)
  // Renamed from `playerGeomOverride` to make the new visibility/collision
  // split obvious — this map is now COLLISION-only. Visibility lives on Scene.
  private readonly playerCollisionOverride: Map<string, Map<string, boolean>> = new Map()

  // Reference to RoomManager. Physics needs `getGeometryRoomId(geomId)` to
  // gate per-player room visibility against the geometry collider list when
  // picking passability. We hold a direct ref (rather than passing yet
  // another callback) because Physics already legitimately needs adjacency
  // info from RoomManager for the stay-in-rooms constraint, so a single
  // reference is cleaner than a thicket of callbacks.
  private readonly roomManager: RoomManager

  constructor(rapier: RapierModule, roomManager: RoomManager) {
    this.rapier = rapier
    this.rapierWorld = new this.rapier.World({ x: 0.0, y: 0.0 })
    this.controller = this.rapierWorld.createCharacterController(0.0)
    this.roomManager = roomManager
  }

  // ── Geometry collider lifecycle ────────────────────────────────────────────
  // RoomManager calls these via the `PhysicsAdapter` interface to install /
  // tear down Rapier colliders as maps come and go.

  addGeometry = (g: FlattenedGeometry): void => {
    const body = this.rapierWorld.createRigidBody(this.rapier.RigidBodyDesc.fixed())
    const desc = this.rapier.ColliderDesc.cuboid(g.hw, g.hd).setTranslation(g.cx, g.cz)
    const collider = this.rapierWorld.createCollider(desc, body)
    this.geometries.set(g.id, { cx: g.cx, cz: g.cz, hw: g.hw, hd: g.hd, collider })
    this.geometryState.set(g.id, true)
  }

  removeGeometry = (id: string): void => {
    const gc = this.geometries.get(id)
    if (gc) {
      const body = gc.collider.parent()
      if (body) this.rapierWorld.removeRigidBody(body)
      this.geometries.delete(id)
    }
    this.geometryState.delete(id)
    // Per-player overrides for the now-removed geometry are also dropped so
    // they don't accumulate forever.
    for (const m of this.playerCollisionOverride.values()) m.delete(id)
  }

  // ── Player kinematic bodies ────────────────────────────────────────────────

  addPlayer(id: string, x: number, z: number): void {
    if (this.charBodies.has(id)) return
    this.playerCollisionOverride.set(id, new Map())
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
    this.playerCollisionOverride.delete(id)
    const charData = this.charBodies.get(id)
    if (charData) {
      this.rapierWorld.removeRigidBody(charData.body)
      this.charBodies.delete(id)
    }
  }

  setPlayerPosition(id: string, x: number, z: number): void {
    const charData = this.charBodies.get(id)
    if (charData) {
      charData.body.setNextKinematicTranslation({ x, y: z })
      this.rapierWorld.step()
    }
  }

  // ── Step the world ─────────────────────────────────────────────────────────

  step(): void { this.rapierWorld.step() }

  // ── Collision toggles ──────────────────────────────────────────────────────

  // ONLY toggles Rapier passability. Does NOT touch any visibility state.
  // When the global flip turns a collider solid on top of a player, eject
  // the player using `resolveOverlap`. Per-player flips do the same for
  // just that player.
  toggleEntityCollisionsOn(entityId: string, playerId: string | undefined, players: PhysicsPlayerAccessor, getAccessibleRooms: (playerId: string) => Set<string>): void {
    if (playerId !== undefined) {
      let m = this.playerCollisionOverride.get(playerId)
      if (!m) { m = new Map(); this.playerCollisionOverride.set(playerId, m) }
      m.set(entityId, true)
      this.resolveOverlap(playerId, entityId, players, getAccessibleRooms)
    } else {
      this.geometryState.set(entityId, true)
      for (const pid of this.charBodies.keys()) {
        this.resolveOverlap(pid, entityId, players, getAccessibleRooms)
      }
    }
  }

  toggleEntityCollisionsOff(entityId: string, playerId?: string): void {
    if (playerId !== undefined) {
      let m = this.playerCollisionOverride.get(playerId)
      if (!m) { m = new Map(); this.playerCollisionOverride.set(playerId, m) }
      m.set(entityId, false)
    } else {
      this.geometryState.set(entityId, false)
    }
  }

  // ── Movement ───────────────────────────────────────────────────────────────

  // Compute the resolved post-collision movement for `playerId` given a
  // joystick-relative input (jx, jz) and a delta-time `dt`. Returns the new
  // position; the caller is responsible for the stay-in-rooms constraint and
  // for writing the value back into player state.
  //
  // Passability is decided by `passabilityResolver(playerId, geomId)`: the
  // caller (Scene) composes per-player room-off + per-player collision
  // override into a single boolean. Other player capsules are always
  // passable (we ghost through other players).
  computeColliderMovement(
    playerId: string,
    desiredX: number,
    desiredZ: number,
    passabilityResolver: (playerId: string, geomId: string) => boolean,
  ): { dx: number; dz: number } {
    const charData = this.charBodies.get(playerId)
    if (!charData) return { dx: 0, dz: 0 }

    const passableHandles = new Set<number>()
    for (const [id, geom] of this.geometries) {
      if (passabilityResolver(playerId, id)) passableHandles.add(geom.collider.handle)
    }
    for (const [id, other] of this.charBodies) {
      if (id !== playerId) passableHandles.add(other.collider.handle)
    }

    this.controller.computeColliderMovement(
      charData.collider,
      { x: desiredX, y: desiredZ },
      undefined,
      undefined,
      (collider: RAPIER_TYPE.Collider) => {
        if (collider.handle === charData.collider.handle) return false
        if (passableHandles.has(collider.handle)) return false
        return true
      },
    )

    const movement = this.controller.computedMovement()
    return { dx: movement.x, dz: movement.y }
  }

  // Per-player (or global) collision-override read. Mirrors the legacy
  // `getPlayerGeometrySnapshot` shape; Scene uses this when composing
  // passability for `processMove`.
  isCollisionSolidForPlayer(playerId: string, geomId: string): boolean {
    const playerOverride = this.playerCollisionOverride.get(playerId)
    if (playerOverride?.has(geomId)) return playerOverride.get(geomId)!
    return this.geometryState.get(geomId) ?? true
  }

  // ── Snapshots ──────────────────────────────────────────────────────────────

  getCollisionStateSnapshot(): Map<string, boolean> {
    return new Map(this.geometryState)
  }

  getPlayerCollisionSnapshot(playerId: string): Map<string, boolean> {
    return new Map(this.playerCollisionOverride.get(playerId) ?? [])
  }

  // ── Dump / restore helpers ─────────────────────────────────────────────────

  applyCollisionState(state: Record<string, boolean>): void {
    for (const [gid, solid] of Object.entries(state)) {
      this.geometryState.set(gid, solid)
    }
  }

  applyPlayerCollisionOverride(playerId: string, overrides: Record<string, boolean>): void {
    const m = new Map<string, boolean>()
    for (const [gid, v] of Object.entries(overrides)) m.set(gid, v)
    this.playerCollisionOverride.set(playerId, m)
  }

  // ── Overlap resolution ─────────────────────────────────────────────────────

  // When a collider turns solid on top of a player, eject the player. Choose
  // the push direction by (a) the axis of minimum penetration and (b) the
  // player's recent velocity (fall back: reverse). The eject target must lie
  // inside one of the player's accessible rooms — otherwise the player is
  // pushed through the far face (or left in place if neither is valid).
  private resolveOverlap(
    playerId: string,
    geomId: string,
    players: PhysicsPlayerAccessor,
    getAccessibleRooms: (playerId: string) => Set<string>,
  ): void {
    const player = players.getPlayer(playerId)
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

    const allowed = getAccessibleRooms(playerId)
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
      players.setPlayerPosition(playerId, nx, nz)
      return
    }
    // No valid candidate — leave the player in place.
  }

  private isInRoomSet(x: number, z: number, rooms: Set<string>): boolean {
    for (const id of rooms) {
      const b = this.roomManager.getRoomBounds(id)
      if (!b) continue
      if (Math.abs(x - b.cx) <= b.hw && Math.abs(z - b.cz) <= b.hd) return true
    }
    return false
  }
}
