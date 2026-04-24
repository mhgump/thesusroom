import type RAPIER_TYPE from '@dimforge/rapier2d-compat'
import { buildMapInstanceArtifacts } from './MapInstance.js'
import type { GameMap } from './GameMap.js'
import type { ButtonConfig, ButtonSpec, ButtonState } from './GameSpec.js'

export type AnimationState = 'IDLE' | 'WALKING'
export type WorldEventType =
  | 'update_animation_state'
  | 'touched'
  | 'damage'
  | 'button_state_change'
  | 'button_config_change'
  | 'button_press'
  | 'button_release'
  | 'vote_region_change'
  | 'room_visibility_change'

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

// ── Map-authored overlays ────────────────────────────────────────────────────

// A button entered `pressed` state. Scenarios react to this via onButtonPress
// handlers; the Room broadcasts the wire `button_state` message.
export interface ButtonPressEvent {
  type: 'button_press'
  buttonId: string
  occupants: string[]
  occupancy: number
}

// A button left `pressed` state (occupants dropped below requiredPlayers and
// the button does not hold-after-release). The `next` state is the state the
// World is transitioning into (`idle` or `cooldown`).
export interface ButtonReleaseEvent {
  type: 'button_release'
  buttonId: string
  next: ButtonState
  occupancy: number
}

// The `ButtonStateChangeEvent` covers every button-state transition the World
// makes, including cooldown→idle. Useful for the Room to broadcast a
// `button_state` wire message uniformly without reconstructing the state from
// press/release events.
export interface ButtonStateChangeEvent {
  type: 'button_state_change'
  buttonId: string
  state: ButtonState
  occupancy: number
}

// Fired when a scenario patches a button's mutable config at runtime.
export interface ButtonConfigChangeEvent {
  type: 'button_config_change'
  buttonId: string
  changes: Partial<ButtonConfig>
}

// Fired when the set of players inside each active vote region changes. The
// Room uses this to broadcast the wire `vote_assignment_change` message;
// scenarios use this to drive `onVoteChanged` handlers.
export interface VoteRegionChangeEvent {
  type: 'vote_region_change'
  // Player id → active region id (or null if the player is not inside any
  // active region). Contains every tracked player.
  assignments: Record<string, string | null>
  // Region ids whose membership changed this frame. Scenarios filter their
  // listeners' `regionIds` against this set.
  changedRegionIds: string[]
}

// Fired when per-player or global room visibility changes. `scope` is the
// target list: `playerIds` when the change is per-player, `'all'` when
// global. The Room forwards a `room_visibility_state` message to the
// appropriate recipients.
export interface RoomVisibilityChangeEvent {
  type: 'room_visibility_change'
  scope: 'all' | { playerIds: string[] }
  updates: Array<{ roomId: string; visible: boolean }>
}

export type WorldEvent =
  | UpdateAnimationStateEvent
  | TouchedEvent
  | DamageEvent
  | ButtonPressEvent
  | ButtonReleaseEvent
  | ButtonStateChangeEvent
  | ButtonConfigChangeEvent
  | VoteRegionChangeEvent
  | RoomVisibilityChangeEvent

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
// GameMap's rooms + connections; the default connections list supplies the
// initial adjacency (which may later be mutated by scenarios via
// setConnectionEnabled).
export interface WorldMapInstance {
  mapInstanceId: string
  scopedRoomIds: string[]
}

// A point-in-time snapshot of everything a World owns that can't be rederived
// from the code in `GameMap`s. The Rapier state and per-room AABBs *are*
// rederivable, so they aren't in the dump — restore rebuilds them by
// re-running `addMap` with the same GameMap (caller-provided) and `addPlayer`
// for each dumped player. Safe to JSON.stringify.
export interface WorldDump {
  disabledEvents: WorldEventType[]
  // mapInstanceIds in the order `addMap` was called. Restore requires the
  // caller to supply the matching GameMap for each id.
  mapInstanceIds: string[]
  players: WorldPlayerState[]
  playerRules: Record<string, string[]>
  playerRoom: Record<string, string | null>
  playerAccessibleRoomsOverride: Record<string, string[]>
  // Current (possibly scenario-mutated) room adjacency. One entry per
  // scoped room id mapping to its enabled neighbours.
  connections: Record<string, string[]>
  // Per-geometry solid/passable flag. Unlisted ids default to solid.
  geometryState: Record<string, boolean>
  // Per-player geometry override: { playerId: { geomId: visible } }.
  playerGeomOverride: Record<string, Record<string, boolean>>
  // Ordered touching-pair keys in "a:b" form (lexicographic by id).
  touchingPairs: string[]
  // Pending moves not yet consumed by `processTick()`.
  moveQueue: Record<string, MoveInput[]>
  // Per-button mutable config (scenarios may have patched it away from spec).
  buttonConfigs: Record<string, ButtonConfig>
  // Per-button current state (idle | pressed | cooldown | disabled).
  buttonStates: Record<string, ButtonState>
  // Per-button current occupant player ids.
  buttonOccupants: Record<string, string[]>
  // Per-button pending cooldown deadline, expressed as sim-tick at which the
  // cooldown fires. Only present while a cooldown is in flight.
  buttonCooldownFireAtTick: Record<string, number>
  // Scoped region id → true for every active vote region.
  activeVoteRegions: string[]
  // Player id → region id they are currently inside (or null).
  playerVoteRegion: Record<string, string | null>
  // Globally-visible room ids (scoped). Unlisted ids default to "visible".
  globalRoomVisible: Record<string, boolean>
  // Per-player room visibility override.
  playerRoomVisible: Record<string, Record<string, boolean>>
}

// Optional deps supplied to the World constructor. The server wires these so
// World's cooldown timers participate in the same sim-clock the Scenario uses
// for its timers; the client (local predictor) leaves them unset and runs
// button-less.
export interface WorldDeps {
  scheduleSimMs?: (ms: number, cb: () => void) => () => void
  getServerTick?: () => number
  getSimMsPerTick?: () => number
}

// The per-tick World output, split between events attributed to a specific
// moving player (touched, update_animation_state, damage from collisions) and
// events that are broadcast-worthy and not player-scoped (button transitions,
// vote region changes, room visibility changes). The Room handles each half
// separately but both come out of the same `processTick()` call.
export interface ProcessTickResult {
  perPlayer: Map<string, WorldEvent[]>
  global: WorldEvent[]
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

  // ── Map-authored overlays ────────────────────────────────────────────────
  // Button authoring lives on the GameMap (`map.buttons`). World owns the
  // runtime state for each authored button: its (possibly scenario-patched)
  // config, current state, and occupant set. Press / release criteria are
  // re-evaluated during processTick when occupancy or config changes.
  private readonly buttonSpecs: Map<string, ButtonSpec> = new Map()
  private readonly buttonConfigs: Map<string, ButtonConfig> = new Map()
  private readonly buttonStates: Map<string, ButtonState> = new Map()
  private readonly buttonOccupants: Map<string, Set<string>> = new Map()
  private readonly buttonCooldownCancels: Map<string, () => void> = new Map()
  // Sim-tick at which a pending cooldown will fire. Present only while the
  // button is in `cooldown` state. Dumped/restored so restore can re-arm the
  // cooldown at the same deadline on the new tick clock.
  private readonly buttonCooldownFireAtTick: Map<string, number> = new Map()

  // Vote region authoring lives on the GameMap. Activation is scenario-
  // controlled via setVoteRegionActive(); World tracks per-player region
  // assignments and emits vote_region_change events when they shift.
  private readonly voteRegionSpecs: Map<string, { id: string; x: number; z: number; radius: number }> = new Map()
  private readonly activeVoteRegions: Set<string> = new Set()
  private readonly playerVoteRegion: Map<string, string | null> = new Map()

  // Room visibility is authored by scenarios, not by maps. Stored here so
  // dump/restore covers it and events flow through the same channel as other
  // world-level changes.
  private readonly globalRoomVisible: Map<string, boolean> = new Map()
  private readonly playerRoomVisible: Map<string, Map<string, boolean>> = new Map()

  // Queue of world-level events produced between processTick() calls. The
  // cooldown scheduler appends state-change events here; processTick drains
  // them into its `global` output on the next tick.
  private pendingGlobalEvents: WorldEvent[] = []

  private readonly deps: WorldDeps

  constructor(disabledEvents: WorldEventType[] = [], deps: WorldDeps = {}) {
    if (!rapierModule) throw new Error('initPhysics() must be awaited before `new World()`')
    this.rapier = rapierModule
    this.rapierWorld = new this.rapier.World({ x: 0.0, y: 0.0 })
    this.controller = this.rapierWorld.createCharacterController(0.0)
    this.disabledEvents = new Set(disabledEvents)
    this.deps = deps
  }

  // ── Map registration ───────────────────────────────────────────────────────

  // Register a map with this world: place rooms in world space from
  // connections, load the default adjacency, instantiate every geometry piece
  // as a Rapier collider in global coords.
  addMap(map: GameMap): WorldMapInstance {
    const { scopedRoomIds, roomBounds, geometry, adjacency } =
      buildMapInstanceArtifacts(map, map.mapInstanceId)

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

    // Load map-authored buttons. Each gets its initial config (copied from the
    // spec so scenarios can mutate without touching the author-time shape), its
    // initial state, and an empty occupant set.
    for (const btn of map.buttons ?? []) {
      this.buttonSpecs.set(btn.id, btn)
      this.buttonConfigs.set(btn.id, {
        requiredPlayers: btn.requiredPlayers,
        holdAfterRelease: btn.holdAfterRelease,
        cooldownMs: btn.cooldownMs,
        enableClientPress: btn.enableClientPress,
      })
      this.buttonStates.set(btn.id, btn.initialState ?? 'idle')
      this.buttonOccupants.set(btn.id, new Set())
    }

    // Load map-authored vote region geometries. Active/inactive is scenario-
    // controlled and starts empty.
    for (const region of map.voteRegions) {
      this.voteRegionSpecs.set(region.id, {
        id: region.id, x: region.x, z: region.z, radius: region.radius,
      })
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
    this.playerVoteRegion.delete(id)
    this.playerRoomVisible.delete(id)
    for (const [bid, occupants] of this.buttonOccupants) {
      if (occupants.delete(id)) this.evaluateButton(bid)
    }
    for (const key of [...this.touchingPairs]) {
      const [a, b] = key.split(':')
      if (a === id || b === id) this.touchingPairs.delete(key)
    }
    const charData = this.charBodies.get(id)
    if (charData) {
      this.rapierWorld.removeRigidBody(charData.body)
      this.charBodies.delete(id)
    }
    // The occupancy change above may have flipped a region's population, too.
    this.recomputeVoteAssignments()
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

  processTick(): ProcessTickResult {
    const perPlayer = new Map<string, WorldEvent[]>()
    for (const [playerId, inputs] of this.moveQueue) {
      const events: WorldEvent[] = []
      for (const { jx, jz, dt } of inputs) {
        events.push(...this.processMove(playerId, jx, jz, dt))
      }
      perPlayer.set(playerId, events)
    }
    this.moveQueue.clear()

    // Re-evaluate map-authored overlays in response to the frame's position
    // updates. Each evaluator appends to `pendingGlobalEvents` as it emits.
    this.recomputeButtonOccupancy()
    this.recomputeVoteAssignments()

    const global = this.pendingGlobalEvents
    this.pendingGlobalEvents = []
    return { perPlayer, global }
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

  // ── Buttons ────────────────────────────────────────────────────────────────

  // Patch a button's mutable config (requiredPlayers, cooldownMs, etc.) at
  // runtime. Emits a button_config_change global event, then re-evaluates the
  // button so a patched threshold can tip the state immediately.
  setButtonConfig(buttonId: string, changes: Partial<ButtonConfig>): void {
    const cfg = this.buttonConfigs.get(buttonId)
    if (!cfg) return
    Object.assign(cfg, changes)
    this.pendingGlobalEvents.push({ type: 'button_config_change', buttonId, changes: { ...changes } })
    this.evaluateButton(buttonId)
  }

  // Overwrite a button's state directly (used by scenarios to force
  // `disabled`, re-arm an `idle`, etc.). Cancels any in-flight cooldown.
  setButtonState(buttonId: string, state: ButtonState): void {
    const current = this.buttonStates.get(buttonId)
    if (current === undefined) return
    const cancel = this.buttonCooldownCancels.get(buttonId)
    if (cancel) { cancel(); this.buttonCooldownCancels.delete(buttonId); this.buttonCooldownFireAtTick.delete(buttonId) }
    this.buttonStates.set(buttonId, state)
    const occupancy = this.buttonOccupants.get(buttonId)?.size ?? 0
    this.pendingGlobalEvents.push({ type: 'button_state_change', buttonId, state, occupancy })
  }

  // Snapshot data used to send a `button_init` wire message on player connect
  // or observer attach. Returns every button's authored spec merged with its
  // current mutable config, state, and occupancy.
  getButtonInitData(): Array<ButtonSpec & { state: ButtonState; occupancy: number }> {
    const out: Array<ButtonSpec & { state: ButtonState; occupancy: number }> = []
    for (const [id, spec] of this.buttonSpecs) {
      const cfg = this.buttonConfigs.get(id)!
      const state = this.buttonStates.get(id) ?? 'idle'
      const occupancy = this.buttonOccupants.get(id)?.size ?? 0
      out.push({ ...spec, ...cfg, state, occupancy })
    }
    return out
  }

  getButtonState(buttonId: string): ButtonState | undefined {
    return this.buttonStates.get(buttonId)
  }

  getButtonOccupants(buttonId: string): string[] {
    const set = this.buttonOccupants.get(buttonId)
    return set ? [...set] : []
  }

  // Recompute occupancy for every button based on current player positions.
  // Any button whose config/occupancy crosses a threshold gets evaluated and
  // may emit press / release / state-change events.
  private recomputeButtonOccupancy(): void {
    for (const [id, spec] of this.buttonSpecs) {
      const occupants = this.buttonOccupants.get(id)!
      let changed = false
      // Drop absent players first, then walk current players.
      for (const pid of [...occupants]) {
        if (!this.players.has(pid)) { occupants.delete(pid); changed = true }
      }
      for (const [pid, p] of this.players) {
        const inside = Math.hypot(p.x - spec.x, p.z - spec.z) <= spec.triggerRadius
        const wasIn = occupants.has(pid)
        if (inside && !wasIn) { occupants.add(pid); changed = true }
        else if (!inside && wasIn) { occupants.delete(pid); changed = true }
      }
      if (changed) this.evaluateButton(id)
    }
  }

  // Examine a button's (state, occupancy, config) triple and, if a transition
  // fires, update state and enqueue the matching global events.
  private evaluateButton(buttonId: string): void {
    const state = this.buttonStates.get(buttonId)
    const occupants = this.buttonOccupants.get(buttonId)
    const config = this.buttonConfigs.get(buttonId)
    if (state === undefined || !occupants || !config) return

    if (state === 'idle' && occupants.size >= config.requiredPlayers) {
      this.buttonStates.set(buttonId, 'pressed')
      this.pendingGlobalEvents.push({
        type: 'button_press', buttonId, occupants: [...occupants], occupancy: occupants.size,
      })
      this.pendingGlobalEvents.push({
        type: 'button_state_change', buttonId, state: 'pressed', occupancy: occupants.size,
      })
      return
    }

    if (state === 'pressed' && !config.holdAfterRelease && occupants.size < config.requiredPlayers) {
      const next: ButtonState = config.cooldownMs > 0 ? 'cooldown' : 'idle'
      this.buttonStates.set(buttonId, next)
      this.pendingGlobalEvents.push({
        type: 'button_release', buttonId, next, occupancy: occupants.size,
      })
      this.pendingGlobalEvents.push({
        type: 'button_state_change', buttonId, state: next, occupancy: occupants.size,
      })
      if (next === 'cooldown') this.armCooldown(buttonId, config.cooldownMs)
      return
    }
  }

  // Schedule the cooldown-end transition. Uses the Room-provided
  // `scheduleSimMs` when present — which ties the deadline to the sim tick
  // clock — or falls back to real-time setTimeout for standalone usage.
  private armCooldown(buttonId: string, durationMs: number): void {
    const cancelPrev = this.buttonCooldownCancels.get(buttonId)
    if (cancelPrev) cancelPrev()
    const nowTick = this.deps.getServerTick?.() ?? 0
    const perTick = this.deps.getSimMsPerTick?.() ?? 50
    const fireAt = nowTick + Math.max(1, Math.ceil(durationMs / perTick))
    this.buttonCooldownFireAtTick.set(buttonId, fireAt)
    const fire = () => {
      this.buttonCooldownCancels.delete(buttonId)
      this.buttonCooldownFireAtTick.delete(buttonId)
      const occ = this.buttonOccupants.get(buttonId)
      const size = occ?.size ?? 0
      this.buttonStates.set(buttonId, 'idle')
      this.pendingGlobalEvents.push({
        type: 'button_state_change', buttonId, state: 'idle', occupancy: size,
      })
      // Give the button a chance to re-press if occupants are still above
      // threshold after the cooldown window.
      this.evaluateButton(buttonId)
    }
    const cancel = this.deps.scheduleSimMs
      ? this.deps.scheduleSimMs(durationMs, fire)
      : (() => { const t = setTimeout(fire, durationMs); return () => clearTimeout(t) })()
    this.buttonCooldownCancels.set(buttonId, cancel)
  }

  // ── Vote regions ───────────────────────────────────────────────────────────

  // Mark a scoped region id as active or inactive. Activation updates which
  // regions the occupancy tracker watches; any region that transitions
  // inactive triggers an immediate reassignment sweep.
  setVoteRegionActive(regionId: string, active: boolean): void {
    if (active) this.activeVoteRegions.add(regionId)
    else this.activeVoteRegions.delete(regionId)
    this.recomputeVoteAssignments()
  }

  isVoteRegionActive(regionId: string): boolean {
    return this.activeVoteRegions.has(regionId)
  }

  // Player id → active region id (or null). Players not currently tracked by
  // the world are absent from the returned map.
  getVoteAssignments(): Map<string, string | null> {
    return new Map(this.playerVoteRegion)
  }

  // Recompute the current region assignment for every player against every
  // active region. Emits a single vote_region_change event when anything
  // moves. Called after player-position updates each tick and whenever the
  // active set mutates.
  private recomputeVoteAssignments(): void {
    const changed: string[] = []
    const next: Record<string, string | null> = {}
    for (const [pid, p] of this.players) {
      let found: string | null = null
      for (const rid of this.activeVoteRegions) {
        const r = this.voteRegionSpecs.get(rid)
        if (!r) continue
        if (Math.hypot(p.x - r.x, p.z - r.z) <= r.radius) { found = rid; break }
      }
      next[pid] = found
      const prev = this.playerVoteRegion.get(pid) ?? null
      if (prev !== found) {
        this.playerVoteRegion.set(pid, found)
        if (prev) changed.push(prev)
        if (found) changed.push(found)
      }
    }
    // Drop entries for players that have left the world.
    for (const pid of [...this.playerVoteRegion.keys()]) {
      if (!this.players.has(pid)) {
        this.playerVoteRegion.delete(pid)
      }
    }
    if (changed.length > 0) {
      const changedRegionIds = [...new Set(changed)]
      this.pendingGlobalEvents.push({ type: 'vote_region_change', assignments: next, changedRegionIds })
    }
  }

  // ── Room visibility ────────────────────────────────────────────────────────

  // Show or hide a set of rooms. When `playerIds` is supplied the change is
  // per-player; otherwise it is global (every player currently tracked). The
  // caller is responsible for supplying only scoped room ids that exist in
  // the world — unknown ids are stored as-is (the client decides what to do
  // with an unknown id).
  setRoomVisible(roomIds: string[], visible: boolean, playerIds?: string[]): void {
    if (playerIds && playerIds.length > 0) {
      for (const pid of playerIds) {
        let m = this.playerRoomVisible.get(pid)
        if (!m) { m = new Map(); this.playerRoomVisible.set(pid, m) }
        for (const rid of roomIds) m.set(rid, visible)
      }
      const updates = roomIds.map(roomId => ({ roomId, visible }))
      this.pendingGlobalEvents.push({ type: 'room_visibility_change', scope: { playerIds: [...playerIds] }, updates })
    } else {
      for (const rid of roomIds) this.globalRoomVisible.set(rid, visible)
      const updates = roomIds.map(roomId => ({ roomId, visible }))
      this.pendingGlobalEvents.push({ type: 'room_visibility_change', scope: 'all', updates })
    }
  }

  getGlobalRoomVisibility(): Map<string, boolean> {
    return new Map(this.globalRoomVisible)
  }

  getPlayerRoomVisibility(playerId: string): Map<string, boolean> {
    return new Map(this.playerRoomVisible.get(playerId) ?? [])
  }

  // ── Read-only snapshots used by scenarios + Room ───────────────────────────

  getGeometryStateSnapshot(): Map<string, boolean> {
    return new Map(this.geometryState)
  }

  getPlayerGeometrySnapshot(playerId: string): Map<string, boolean> {
    return new Map(this.playerGeomOverride.get(playerId) ?? [])
  }

  getActiveVoteRegions(): string[] {
    return [...this.activeVoteRegions]
  }

  // Drop any queued world-level events. Called during scenario initial
  // seeding so the initial room-visibility / button setup (which enqueues
  // events) doesn't produce wire broadcasts for a room that has no players
  // yet.
  clearPendingGlobalEvents(): void {
    this.pendingGlobalEvents = []
  }

  // Pull and clear any world-level events queued since the last call. The
  // Room uses this after its scheduled callbacks fire so cooldown-triggered
  // state changes are broadcast in the same tick they happened in.
  drainPendingGlobalEvents(): WorldEvent[] {
    const out = this.pendingGlobalEvents
    this.pendingGlobalEvents = []
    return out
  }

  // ── Dump / restore ─────────────────────────────────────────────────────────

  // Produce a JSON-serializable snapshot of everything the World owns that
  // can't be rederived from the GameMaps attached via `addMap`. See
  // `WorldDump` for the shape. Use `restoreState` on a fresh World (same
  // disabledEvents, same maps re-added in order) to round-trip.
  dumpState(): WorldDump {
    const players: WorldPlayerState[] = []
    for (const p of this.players.values()) {
      players.push({ id: p.id, x: p.x, z: p.z, animState: p.animState, hp: p.hp, vx: p.vx, vz: p.vz })
    }
    const playerRules: Record<string, string[]> = {}
    for (const [pid, rules] of this.playerRules) playerRules[pid] = [...rules]

    const playerRoom: Record<string, string | null> = {}
    for (const [pid, rid] of this.playerRoom) playerRoom[pid] = rid

    const playerAccessibleRoomsOverride: Record<string, string[]> = {}
    for (const [pid, set] of this.playerAccessibleRoomsOverride) {
      playerAccessibleRoomsOverride[pid] = [...set]
    }

    const connections: Record<string, string[]> = {}
    for (const [a, neigh] of this.connections) connections[a] = [...neigh]

    const geometryState: Record<string, boolean> = {}
    for (const [gid, visible] of this.geometryState) geometryState[gid] = visible

    const playerGeomOverride: Record<string, Record<string, boolean>> = {}
    for (const [pid, m] of this.playerGeomOverride) {
      const o: Record<string, boolean> = {}
      for (const [gid, v] of m) o[gid] = v
      playerGeomOverride[pid] = o
    }

    const moveQueue: Record<string, MoveInput[]> = {}
    for (const [pid, inputs] of this.moveQueue) {
      moveQueue[pid] = inputs.map(i => ({ jx: i.jx, jz: i.jz, dt: i.dt }))
    }

    const buttonConfigs: Record<string, ButtonConfig> = {}
    for (const [id, cfg] of this.buttonConfigs) buttonConfigs[id] = { ...cfg }
    const buttonStates: Record<string, ButtonState> = {}
    for (const [id, st] of this.buttonStates) buttonStates[id] = st
    const buttonOccupants: Record<string, string[]> = {}
    for (const [id, occ] of this.buttonOccupants) buttonOccupants[id] = [...occ]
    const buttonCooldownFireAtTick: Record<string, number> = {}
    for (const [id, t] of this.buttonCooldownFireAtTick) buttonCooldownFireAtTick[id] = t

    const playerVoteRegion: Record<string, string | null> = {}
    for (const [pid, rid] of this.playerVoteRegion) playerVoteRegion[pid] = rid

    const globalRoomVisible: Record<string, boolean> = {}
    for (const [rid, visible] of this.globalRoomVisible) globalRoomVisible[rid] = visible
    const playerRoomVisible: Record<string, Record<string, boolean>> = {}
    for (const [pid, m] of this.playerRoomVisible) {
      const o: Record<string, boolean> = {}
      for (const [rid, v] of m) o[rid] = v
      playerRoomVisible[pid] = o
    }

    return {
      disabledEvents: [...this.disabledEvents],
      mapInstanceIds: [...this.mapInstances.keys()],
      players,
      playerRules,
      playerRoom,
      playerAccessibleRoomsOverride,
      connections,
      geometryState,
      playerGeomOverride,
      touchingPairs: [...this.touchingPairs],
      moveQueue,
      buttonConfigs,
      buttonStates,
      buttonOccupants,
      buttonCooldownFireAtTick,
      activeVoteRegions: [...this.activeVoteRegions],
      playerVoteRegion,
      globalRoomVisible,
      playerRoomVisible,
    }
  }

  // Rehydrate a fresh World from a dump. The World must have been constructed
  // with `disabledEvents` matching the dump and must have no maps or players
  // attached yet; the caller supplies the GameMaps keyed by mapInstanceId
  // (same instances as when the dump was produced). Re-runs `addMap` and
  // `addPlayer` to rebuild Rapier state, then overlays the dumped logical
  // state verbatim — bypassing side-effectful setters like `toggleGeometryOn`
  // so restore doesn't re-trigger player ejects.
  restoreState(dump: WorldDump, mapsByInstance: Map<string, GameMap>): void {
    if (this.players.size > 0 || this.mapInstances.size > 0) {
      throw new Error('World.restoreState called on a non-empty World')
    }
    // Reattach maps in original order. addMap populates roomBounds, seeds
    // `connections` with defaults, and creates Rapier geometry colliders.
    for (const mid of dump.mapInstanceIds) {
      const map = mapsByInstance.get(mid)
      if (!map) throw new Error(`World.restoreState: missing GameMap for instance '${mid}'`)
      this.addMap(map)
    }
    // Overwrite connections with the dumped set (scenarios may have mutated
    // the defaults via setConnectionEnabled).
    this.connections.clear()
    for (const [a, neigh] of Object.entries(dump.connections)) {
      this.connections.set(a, new Set(neigh))
    }
    // Geometry state overlay. addMap set every known geometry to `true`; the
    // dump may flip some to `false`. Unknown ids are allowed (scenario-only
    // ids referenced before the geometry exists).
    for (const [gid, visible] of Object.entries(dump.geometryState)) {
      this.geometryState.set(gid, visible)
    }
    // Players: recreate Rapier bodies at their dumped positions, then
    // restore per-player fields.
    for (const p of dump.players) {
      this.addPlayer(p.id, p.x, p.z)
      const ps = this.players.get(p.id)!
      ps.animState = p.animState
      ps.hp = p.hp
      ps.vx = p.vx
      ps.vz = p.vz
    }
    for (const [pid, rules] of Object.entries(dump.playerRules)) {
      this.playerRules.set(pid, [...rules])
    }
    for (const [pid, rid] of Object.entries(dump.playerRoom)) {
      this.playerRoom.set(pid, rid)
    }
    for (const [pid, rooms] of Object.entries(dump.playerAccessibleRoomsOverride)) {
      this.playerAccessibleRoomsOverride.set(pid, new Set(rooms))
    }
    for (const [pid, overrides] of Object.entries(dump.playerGeomOverride)) {
      const m = new Map<string, boolean>()
      for (const [gid, v] of Object.entries(overrides)) m.set(gid, v)
      this.playerGeomOverride.set(pid, m)
    }
    for (const key of dump.touchingPairs) this.touchingPairs.add(key)
    for (const [pid, inputs] of Object.entries(dump.moveQueue)) {
      this.moveQueue.set(pid, inputs.map(i => ({ jx: i.jx, jz: i.jz, dt: i.dt })))
    }
    // Button state overlay. addMap seeded configs from specs; the dump may
    // have scenario-patched values. Re-arm any pending cooldown at the same
    // fireAtTick using the restored scheduler.
    for (const [id, cfg] of Object.entries(dump.buttonConfigs)) {
      this.buttonConfigs.set(id, { ...cfg })
    }
    for (const [id, st] of Object.entries(dump.buttonStates)) {
      this.buttonStates.set(id, st)
    }
    for (const [id, occ] of Object.entries(dump.buttonOccupants)) {
      const set = this.buttonOccupants.get(id)
      if (set) { for (const pid of occ) set.add(pid) }
      else { this.buttonOccupants.set(id, new Set(occ)) }
    }
    for (const [id, fireAt] of Object.entries(dump.buttonCooldownFireAtTick)) {
      const cfg = this.buttonConfigs.get(id)
      if (!cfg) continue
      const now = this.deps.getServerTick?.() ?? 0
      const perTick = this.deps.getSimMsPerTick?.() ?? 50
      const ms = Math.max(0, (fireAt - now) * perTick)
      this.armCooldown(id, ms)
      this.buttonCooldownFireAtTick.set(id, fireAt)
    }
    // Vote region + room visibility state.
    for (const rid of dump.activeVoteRegions) this.activeVoteRegions.add(rid)
    for (const [pid, rid] of Object.entries(dump.playerVoteRegion)) {
      this.playerVoteRegion.set(pid, rid)
    }
    for (const [rid, visible] of Object.entries(dump.globalRoomVisible)) {
      this.globalRoomVisible.set(rid, visible)
    }
    for (const [pid, overrides] of Object.entries(dump.playerRoomVisible)) {
      const m = new Map<string, boolean>()
      for (const [rid, v] of Object.entries(overrides)) m.set(rid, v)
      this.playerRoomVisible.set(pid, m)
    }
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
