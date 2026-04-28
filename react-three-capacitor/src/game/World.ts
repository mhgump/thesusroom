import type RAPIER_TYPE from '@dimforge/rapier2d-compat'
import type { GameMap } from './GameMap.js'
import type { ButtonConfig, ButtonSpec, ButtonState, VoteRegionSpec } from './GameSpec.js'
import type { RoomSpec, Wall } from './RoomSpec.js'
import type { RoomWorldPos, TransitionRegion } from './WorldSpec.js'
import type { CameraConstraintShapes } from './CameraConstraint.js'
import { RoomManager, type PhysicsAdapter } from './RoomManager.js'
import { Physics } from './Physics.js'
import { Scene } from './Scene.js'

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

// A button entered `pressed` state.
export interface ButtonPressEvent {
  type: 'button_press'
  buttonId: string
  occupants: string[]
  occupancy: number
}

// A button left `pressed` state.
export interface ButtonReleaseEvent {
  type: 'button_release'
  buttonId: string
  next: ButtonState
  occupancy: number
}

export interface ButtonStateChangeEvent {
  type: 'button_state_change'
  buttonId: string
  state: ButtonState
  occupancy: number
}

export interface ButtonConfigChangeEvent {
  type: 'button_config_change'
  buttonId: string
  changes: Partial<ButtonConfig>
}

export interface VoteRegionChangeEvent {
  type: 'vote_region_change'
  assignments: Record<string, string | null>
  changedRegionIds: string[]
}

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

const ANIM_THRESHOLD = 0.05
// CAPSULE_RADIUS lives on Physics; the touch radius here is purely a
// player-vs-player distance check that doesn't need the Rapier value.
const CAPSULE_RADIUS = 0.0282
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

// Global-coord AABB of a room's floor (for the stay-in-rooms constraint).
export interface RoomBounds { cx: number; cz: number; hw: number; hd: number }

export interface MoveInput { jx: number; jz: number; dt: number }

// Per-map-instance record stored on the World. `addMap` populates this from a
// GameMap's rooms + connections; the default connections list supplies the
// initial adjacency (which may later be mutated by scenarios via
// setConnectionEnabled).
export interface WorldMapInstance {
  mapInstanceId: string
  scopedRoomIds: string[]
}

// A room as seen by the renderer: the local RoomSpec plus world-space centre
// and the scoping metadata needed to key into visibility/adjacency maps.
export interface WorldRoomView {
  scopedId: string
  mapInstanceId: string
  localRoomId: string
  room: RoomSpec
  worldPos: RoomWorldPos
}

// Per-map ids whose lifecycle is tied to addMap/removeMap. After Task 3 the
// visibility/collision state for geometries is split (Scene/Physics own the
// per-id maps) but the World still tracks geometryIds per-map so it can
// clean up the per-player overrides on removeMap.
interface WorldMapOverlayIds {
  voteRegionIds: string[]
  buttonIds: string[]
  geometryIds: string[]
}

// A point-in-time snapshot of everything a World owns that can't be rederived
// from the code in `GameMap`s.
export interface WorldDump {
  disabledEvents: WorldEventType[]
  mapInstanceIds: string[]
  players: WorldPlayerState[]
  playerRules: Record<string, string[]>
  playerRoom: Record<string, string | null>
  playerAccessibleRoomsOverride: Record<string, string[]>
  connections: Record<string, string[]>
  // Per-geometry collision flag. Unlisted ids default to solid. Named for
  // backwards compat with the pre-Task-3 dump format; this is the COLLISION
  // half. After the visibility/collision split there is also a separate
  // `entityVisibility` field for the visibility half.
  geometryState: Record<string, boolean>
  // Per-player collision override: { playerId: { geomId: solid } }. Renamed
  // internally to playerCollisionOverride; the dump key keeps the legacy
  // name for backwards-compat with archived dumps.
  playerGeomOverride: Record<string, Record<string, boolean>>
  // Per-geometry visibility flag (split out of the legacy geometryState).
  globalEntityVisible: Record<string, boolean>
  playerEntityVisible: Record<string, Record<string, boolean>>
  touchingPairs: string[]
  moveQueue: Record<string, MoveInput[]>
  buttonConfigs: Record<string, ButtonConfig>
  buttonStates: Record<string, ButtonState>
  buttonOccupants: Record<string, string[]>
  buttonCooldownFireAtTick: Record<string, number>
  activeVoteRegions: string[]
  playerVoteRegion: Record<string, string | null>
  globalRoomVisible: Record<string, boolean>
  playerRoomVisible: Record<string, Record<string, boolean>>
}

export interface WorldDeps {
  scheduleSimMs?: (ms: number, cb: () => void) => () => void
  getServerTick?: () => number
  getSimMsPerTick?: () => number
}

export interface ProcessTickResult {
  perPlayer: Map<string, WorldEvent[]>
  global: WorldEvent[]
}

// ── World class (facade over RoomManager + Physics + Scene) ──────────────────

// World is now a thin facade. It owns:
//   - the player state map (WorldPlayerState records)
//   - button + vote-region state
//   - the disabled-events filter and the move queue
//
// It delegates:
//   - room graph / map instances → RoomManager
//   - Rapier collision + character controller → Physics
//   - per-player room/entity visibility + processMove orchestration → Scene
//
// Public API is preserved for existing callers (Room.ts, scenarios). The
// legacy `toggleGeometryOn/Off` methods are kept (deprecated) and now
// internally fan out to BOTH the Scene visibility setter and the Physics
// collision setter so today's combined behavior is preserved.
export class World {
  // Player records live on World because they're shared across Physics
  // (kinematic body), Scene (currentRoom) and the button/vote/touched
  // logic (still on World). A single source of truth keeps the touch/anim
  // events local to World without an extra plumbing layer.
  readonly players: Map<string, WorldPlayerState> = new Map()
  private readonly playerRules: Map<string, string[]> = new Map()
  private readonly disabledEvents: Set<WorldEventType>
  private readonly touchingPairs: Set<string> = new Set()
  private moveQueue: Map<string, MoveInput[]> = new Map()

  // Three-class composition. RoomManager constructed first; Physics is given
  // a ref to it so it can answer adjacency questions during overlap
  // resolution and the stay-in-rooms check; Scene composes the two.
  private readonly roomManager: RoomManager = new RoomManager()
  private readonly physics: Physics
  private readonly scene: Scene

  // Per-map overlay state that World still owns: button + vote-region ids
  // introduced by each map, and the geometry ids (so per-player overrides
  // can be cleaned up on removeMap).
  private readonly mapOverlayIds: Map<string, WorldMapOverlayIds> = new Map()
  private readonly attachedMaps: Map<string, GameMap> = new Map()

  // Map-authored overlays still live on World.
  private readonly buttonSpecs: Map<string, ButtonSpec> = new Map()
  private readonly buttonConfigs: Map<string, ButtonConfig> = new Map()
  private readonly buttonStates: Map<string, ButtonState> = new Map()
  private readonly buttonOccupants: Map<string, Set<string>> = new Map()
  private readonly buttonCooldownCancels: Map<string, () => void> = new Map()
  private readonly buttonCooldownFireAtTick: Map<string, number> = new Map()

  private readonly voteRegionSpecs: Map<string, { id: string; x: number; z: number; radius: number }> = new Map()
  private readonly activeVoteRegions: Set<string> = new Set()
  private readonly playerVoteRegion: Map<string, string | null> = new Map()

  // World-level event queue (drained by processTick). Scene appends room/
  // entity-visibility changes here too — World pulls Scene's queue at drain
  // time and concatenates.
  private pendingGlobalEvents: WorldEvent[] = []

  private readonly deps: WorldDeps

  constructor(disabledEvents: WorldEventType[] = [], deps: WorldDeps = {}) {
    if (!rapierModule) throw new Error('initPhysics() must be awaited before `new World()`')
    this.physics = new Physics(rapierModule, this.roomManager)
    this.scene = new Scene(this.roomManager, this.physics)
    this.disabledEvents = new Set(disabledEvents)
    this.deps = deps
  }

  // PhysicsAdapter forwarded to RoomManager. Rapier collider lifecycle now
  // lives on Physics; RoomManager calls add/removeGeometry on it directly.
  private readonly physicsAdapter: PhysicsAdapter = {
    addGeometry: (g) => this.physics.addGeometry(g),
    removeGeometry: (id) => this.physics.removeGeometry(id),
  }

  // ── Map registration ───────────────────────────────────────────────────────

  addMap(map: GameMap): WorldMapInstance {
    const before = new Set(this.collectGeometryIds())
    const installed = this.roomManager.addMap(map, this.physicsAdapter)
    const geometryIds = this.collectGeometryIds().filter(id => !before.has(id))

    const buttonIds: string[] = []
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
      buttonIds.push(btn.id)
    }
    const voteRegionIds: string[] = []
    for (const region of map.voteRegions) {
      this.voteRegionSpecs.set(region.id, region)
      voteRegionIds.push(region.id)
    }

    this.physics.step()
    this.attachedMaps.set(map.mapInstanceId, map)
    this.mapOverlayIds.set(map.mapInstanceId, { voteRegionIds, buttonIds, geometryIds })
    return installed
  }

  addRoom(args: {
    targetRoomScopedId: string
    connectionAtTarget: { wall: Wall; length: number; position: number; transitionRegion: TransitionRegion }
    connectionAtNew: { wall: Wall; length: number; position: number; transitionRegion: TransitionRegion }
    newRoom: RoomSpec
  }): { scopedRoomId: string } {
    const before = new Set(this.collectGeometryIds())
    const result = this.roomManager.addRoom(args, this.physicsAdapter)
    const geometryIds = this.collectGeometryIds().filter(id => !before.has(id))
    const view = this.roomManager.getRoomByScopedId(result.scopedRoomId)
    if (view) {
      this.mapOverlayIds.set(view.mapInstanceId, { voteRegionIds: [], buttonIds: [], geometryIds })
    }
    this.physics.step()
    return result
  }

  attachMap(args: {
    map: GameMap
    targetRoomScopedId: string
    connectionAtTarget: { wall: Wall; length: number; position: number; transitionRegion: TransitionRegion }
    mapRoomId: string
    connectionAtMapRoom: { wall: Wall; length: number; position: number; transitionRegion: TransitionRegion }
  }): WorldMapInstance {
    const before = new Set(this.collectGeometryIds())
    const installed = this.roomManager.attachMap(args, this.physicsAdapter)
    const geometryIds = this.collectGeometryIds().filter(id => !before.has(id))

    const buttonIds: string[] = []
    for (const btn of args.map.buttons ?? []) {
      this.buttonSpecs.set(btn.id, btn)
      this.buttonConfigs.set(btn.id, {
        requiredPlayers: btn.requiredPlayers,
        holdAfterRelease: btn.holdAfterRelease,
        cooldownMs: btn.cooldownMs,
        enableClientPress: btn.enableClientPress,
      })
      this.buttonStates.set(btn.id, btn.initialState ?? 'idle')
      this.buttonOccupants.set(btn.id, new Set())
      buttonIds.push(btn.id)
    }
    const voteRegionIds: string[] = []
    for (const region of args.map.voteRegions) {
      this.voteRegionSpecs.set(region.id, region)
      voteRegionIds.push(region.id)
    }

    this.physics.step()
    this.attachedMaps.set(args.map.mapInstanceId, args.map)
    this.mapOverlayIds.set(args.map.mapInstanceId, { voteRegionIds, buttonIds, geometryIds })
    return installed
  }

  removeRoom(scopedRoomIdToRemove: string): { ok: true } | { ok: false; reason: 'would-disconnect' | 'not-found' | 'is-root' } {
    const view = this.roomManager.getRoomByScopedId(scopedRoomIdToRemove)
    const before = new Set(this.collectGeometryIds())
    const result = this.roomManager.removeRoom(scopedRoomIdToRemove, this.physicsAdapter)
    if (!result.ok) return result
    const removed = before.size === 0 ? new Set<string>() : new Set([...before].filter(id => !this.physics.getCollisionStateSnapshot().has(id)))
    if (view) {
      this.scene.onMapRemoved(new Set([view.scopedId]), removed)
      for (const [pid, rid] of [...this.players.entries()]) {
        if (rid && this.scene.getPlayerRoom(pid) === view.scopedId) this.scene.setPlayerRoom(pid, null)
        void rid
      }
    }
    this.physics.step()
    return { ok: true }
  }

  saveAsMapSpec(mapInstanceId: string): ReturnType<RoomManager['saveAsMapSpec']> {
    return this.roomManager.saveAsMapSpec(mapInstanceId)
  }

  removeMap(mapInstanceId: string): void {
    const overlay = this.mapOverlayIds.get(mapInstanceId)
    const result = this.roomManager.removeMap(mapInstanceId, this.physicsAdapter)
    const removedScoped = new Set(result.removedScopedRoomIds)
    const removedGeomIds = new Set(result.removedGeometryIds)

    this.scene.onMapRemoved(removedScoped, removedGeomIds)

    if (overlay) {
      for (const bid of overlay.buttonIds) {
        this.buttonSpecs.delete(bid)
        this.buttonConfigs.delete(bid)
        this.buttonStates.delete(bid)
        this.buttonOccupants.delete(bid)
        const cancel = this.buttonCooldownCancels.get(bid)
        if (cancel) { cancel(); this.buttonCooldownCancels.delete(bid) }
        this.buttonCooldownFireAtTick.delete(bid)
      }
      const removedVoteRegionIds = new Set(overlay.voteRegionIds)
      for (const rid of removedVoteRegionIds) {
        this.voteRegionSpecs.delete(rid)
        this.activeVoteRegions.delete(rid)
      }
      for (const [pid, rid] of this.playerVoteRegion) {
        if (rid && removedVoteRegionIds.has(rid)) this.playerVoteRegion.set(pid, null)
      }
    }

    this.mapOverlayIds.delete(mapInstanceId)
    this.attachedMaps.delete(mapInstanceId)
    this.physics.step()
  }

  getMapInstance(mapInstanceId: string): WorldMapInstance | undefined {
    return this.roomManager.getMapInstance(mapInstanceId)
  }

  getRoomsInMapInstance(mapInstanceId: string): string[] {
    return this.roomManager.getRoomsInMapInstance(mapInstanceId)
  }

  getMapInstanceIds(): string[] {
    return this.roomManager.getMapInstanceIds()
  }

  getConnectionsSnapshot(): Record<string, string[]> {
    return this.roomManager.getConnectionsSnapshot()
  }

  applyConnectionsSnapshot(snapshot: Record<string, string[]>): void {
    this.roomManager.applyConnectionsSnapshot(snapshot)
  }

  getRoomManager(): RoomManager { return this.roomManager }
  getPhysics(): Physics { return this.physics }
  getScene(): Scene { return this.scene }

  // ── Rendering-facing accessors ─────────────────────────────────────────────

  getAllRooms(): WorldRoomView[] {
    return this.roomManager.getAllRooms()
  }

  getRoomByScopedId(scopedId: string): WorldRoomView | undefined {
    return this.roomManager.getRoomByScopedId(scopedId)
  }

  getCameraShapes(): CameraConstraintShapes {
    return this.roomManager.getCameraShapes()
  }

  getAdjacentRoomIds(scopedRoomId: string): string[] {
    return this.roomManager.getAdjacentRoomIds(scopedRoomId)
  }

  getRoomAtPosition(x: number, z: number): string | null {
    return this.roomManager.getRoomAtPosition(x, z)
  }

  isRoomOverlapping(scopedRoomId: string): boolean {
    return this.roomManager.isRoomOverlapping(scopedRoomId)
  }

  getAllVoteRegions(): Array<VoteRegionSpec & { roomId: string | null }> {
    const out: Array<VoteRegionSpec & { roomId: string | null }> = []
    for (const map of this.attachedMaps.values()) {
      for (const region of map.voteRegions) {
        out.push({ ...region, roomId: this.getRoomAtPosition(region.x, region.z) })
      }
    }
    return out
  }

  getMapsVersion(): number { return this.roomManager.getMapsVersion() }

  subscribeToMapChanges(cb: () => void): () => void {
    return this.roomManager.subscribeToMapChanges(cb)
  }

  // ── Rooms & accessibility (delegates to Scene) ─────────────────────────────

  getPlayerRoom(playerId: string): string | null {
    return this.scene.getPlayerRoom(playerId)
  }

  setPlayerRoom(playerId: string, scopedRoomId: string | null): void {
    this.scene.setPlayerRoom(playerId, scopedRoomId)
  }

  setConnectionEnabled(scopedRoomIdA: string, scopedRoomIdB: string, enabled: boolean): void {
    this.roomManager.setConnectionEnabled(scopedRoomIdA, scopedRoomIdB, enabled)
  }

  isConnectionEnabled(scopedRoomIdA: string, scopedRoomIdB: string): boolean {
    return this.roomManager.isConnectionEnabled(scopedRoomIdA, scopedRoomIdB)
  }

  getAccessibleRooms(playerId: string): Set<string> {
    return this.scene.getAccessibleRooms(playerId, (id) => {
      const p = this.players.get(id); return p ? { x: p.x, z: p.z } : undefined
    })
  }

  setAccessibleRoomsOverride(playerId: string, scopedRoomIds: string[] | null): void {
    this.scene.setAccessibleRoomsOverride(playerId, scopedRoomIds)
  }

  // ── Geometry toggles (legacy convenience; deprecated) ──────────────────────

  // @deprecated Prefer Scene.toggleEntityVisibilityOn (visibility) and
  // Physics.toggleEntityCollisionsOn (collision) for the split semantics.
  // This convenience flips both at once to preserve pre-Task-3 behavior for
  // existing callers (Room.ts hub-transfer, scenarios using setGeometryVisible).
  toggleGeometryOn(id: string, playerId?: string): void {
    this.scene.setEntityVisibleLegacy(id, true, playerId)
    this.physics.toggleEntityCollisionsOn(
      id,
      playerId,
      {
        getPlayer: (pid) => this.players.get(pid),
        setPlayerPosition: (pid, x, z) => this.setPlayerPosition(pid, x, z),
      },
      (pid) => this.getAccessibleRooms(pid),
    )
  }

  // @deprecated See toggleGeometryOn.
  toggleGeometryOff(id: string, playerId?: string): void {
    this.scene.setEntityVisibleLegacy(id, false, playerId)
    this.physics.toggleEntityCollisionsOff(id, playerId)
  }

  // ── Players ────────────────────────────────────────────────────────────────

  addPlayer(id: string, x = 0, z = 0): void {
    this.players.set(id, { id, x, z, animState: 'IDLE', hp: 2, vx: 0, vz: 0 })
    this.physics.addPlayer(id, x, z)
  }

  removePlayer(id: string): void {
    this.players.delete(id)
    this.playerRules.delete(id)
    this.scene.removePlayer(id)
    this.playerVoteRegion.delete(id)
    for (const [bid, occupants] of this.buttonOccupants) {
      if (occupants.delete(id)) this.evaluateButton(bid)
    }
    for (const key of [...this.touchingPairs]) {
      const [a, b] = key.split(':')
      if (a === id || b === id) this.touchingPairs.delete(key)
    }
    this.physics.removePlayer(id)
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
    this.physics.setPlayerPosition(id, x, z)
    this.advancePlayerRoom(id)
  }

  // ── Movement ───────────────────────────────────────────────────────────────

  processMove(playerId: string, jx: number, jz: number, dt: number): WorldEvent[] {
    const player = this.players.get(playerId)
    if (!player) return []

    // Delegate to Scene.processMove with accessors that bridge into World's
    // player state and event sourcing (animation + touched events stay here
    // since the player records they read live on World).
    const result = this.scene.processMove(playerId, jx, jz, dt, {
      getPlayer: (id) => this.players.get(id),
      writePlayerPos: (id, x, z, prevX, prevZ) => {
        const p = this.players.get(id)
        if (!p) return
        p.x = x; p.z = z
        p.vx = x - prevX; p.vz = z - prevZ
      },
      animationStateUpdate: (id, jjx, jjz) => {
        const p = this.players.get(id)
        if (!p) return null
        const newAnimState: AnimationState = Math.hypot(jjx, jjz) > ANIM_THRESHOLD ? 'WALKING' : 'IDLE'
        if (newAnimState === p.animState) return null
        p.animState = newAnimState
        if (this.disabledEvents.has('update_animation_state')) return null
        return { type: 'update_animation_state', playerId: id, animState: newAnimState }
      },
      touchUpdate: (id) => {
        if (this.disabledEvents.has('touched')) return []
        const out: WorldEvent[] = []
        const p = this.players.get(id)
        if (!p) return out
        for (const [otherId, other] of this.players) {
          if (otherId === id) continue
          const a = id < otherId ? id : otherId
          const b = id < otherId ? otherId : id
          const pairKey = `${a}:${b}`
          const nowTouching = Math.hypot(p.x - other.x, p.z - other.z) < TOUCH_RADIUS
          const wasTouching = this.touchingPairs.has(pairKey)
          if (nowTouching && !wasTouching) {
            this.touchingPairs.add(pairKey)
            out.push({ type: 'touched', playerIdA: id, playerIdB: otherId })
          } else if (!nowTouching && wasTouching) {
            this.touchingPairs.delete(pairKey)
          }
        }
        return out
      },
    })

    return result.events
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

    this.recomputeButtonOccupancy()
    this.recomputeVoteAssignments()

    const sceneEvents = this.scene.drainPendingGlobalEvents()
    const global = [...this.pendingGlobalEvents, ...sceneEvents]
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

  // ── Buttons (unchanged — World still owns the button machinery) ────────────

  setButtonConfig(buttonId: string, changes: Partial<ButtonConfig>): void {
    const cfg = this.buttonConfigs.get(buttonId)
    if (!cfg) return
    Object.assign(cfg, changes)
    this.pendingGlobalEvents.push({ type: 'button_config_change', buttonId, changes: { ...changes } })
    this.evaluateButton(buttonId)
  }

  setButtonState(buttonId: string, state: ButtonState): void {
    const current = this.buttonStates.get(buttonId)
    if (current === undefined) return
    const cancel = this.buttonCooldownCancels.get(buttonId)
    if (cancel) { cancel(); this.buttonCooldownCancels.delete(buttonId); this.buttonCooldownFireAtTick.delete(buttonId) }
    this.buttonStates.set(buttonId, state)
    const occupancy = this.buttonOccupants.get(buttonId)?.size ?? 0
    this.pendingGlobalEvents.push({ type: 'button_state_change', buttonId, state, occupancy })
  }

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

  private recomputeButtonOccupancy(): void {
    for (const [id, spec] of this.buttonSpecs) {
      const occupants = this.buttonOccupants.get(id)!
      let changed = false
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
      this.evaluateButton(buttonId)
    }
    const cancel = this.deps.scheduleSimMs
      ? this.deps.scheduleSimMs(durationMs, fire)
      : (() => { const t = setTimeout(fire, durationMs); return () => clearTimeout(t) })()
    this.buttonCooldownCancels.set(buttonId, cancel)
  }

  // ── Vote regions ───────────────────────────────────────────────────────────

  setVoteRegionActive(regionId: string, active: boolean): void {
    if (active) this.activeVoteRegions.add(regionId)
    else this.activeVoteRegions.delete(regionId)
    this.recomputeVoteAssignments()
  }

  isVoteRegionActive(regionId: string): boolean {
    return this.activeVoteRegions.has(regionId)
  }

  getVoteAssignments(): Map<string, string | null> {
    return new Map(this.playerVoteRegion)
  }

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

  // ── Room visibility (delegates to Scene) ───────────────────────────────────

  setRoomVisible(roomIds: string[], visible: boolean, playerIds?: string[]): void {
    this.scene.setRoomVisible(roomIds, visible, playerIds)
  }

  // Whether a given player has at least one visible room in the named map
  // instance. Used by the wire layer to filter `map_add` / `map_remove` /
  // `world_reset` payloads so a player whose every room is toggled off
  // doesn't see the map's topology + geometry sprayed at them.
  playerHasMapVisible(playerId: string, mapInstanceId: string): boolean {
    return this.scene.playerHasMapVisible(playerId, mapInstanceId)
  }

  getGlobalRoomVisibility(): Map<string, boolean> {
    return this.scene.getGlobalRoomVisibility()
  }

  getPlayerRoomVisibility(playerId: string): Map<string, boolean> {
    return this.scene.getPlayerRoomVisibility(playerId)
  }

  // ── Read-only snapshots used by scenarios + Room ───────────────────────────

  getGeometryStateSnapshot(): Map<string, boolean> {
    // Pre-Task-3 callers expected this to be the combined state used to
    // hydrate `geometry_state` wire messages on the client (which drives
    // both renderer visibility and predicted collision). After the
    // visibility/collision split, the wire message still carries one bit
    // per id and the deprecated `toggleGeometry*` API keeps visibility +
    // collision in lockstep — so reading from the visibility side is
    // correct for the wire payload semantically (and matches the legacy
    // pre-split bit when only the deprecated path is used). Callers that
    // need the raw Rapier-side flag should use Physics directly.
    return this.scene.getGlobalEntityVisibility()
  }

  getPlayerGeometrySnapshot(playerId: string): Map<string, boolean> {
    return this.scene.getPlayerEntityVisibility(playerId)
  }

  getActiveVoteRegions(): string[] {
    return [...this.activeVoteRegions]
  }

  clearPendingGlobalEvents(): void {
    this.pendingGlobalEvents = []
    this.scene.clearPendingGlobalEvents()
  }

  drainPendingGlobalEvents(): WorldEvent[] {
    const sceneEvents = this.scene.drainPendingGlobalEvents()
    const out = [...this.pendingGlobalEvents, ...sceneEvents]
    this.pendingGlobalEvents = []
    return out
  }

  // ── Dump / restore ─────────────────────────────────────────────────────────

  dumpState(): WorldDump {
    const players: WorldPlayerState[] = []
    for (const p of this.players.values()) {
      players.push({ id: p.id, x: p.x, z: p.z, animState: p.animState, hp: p.hp, vx: p.vx, vz: p.vz })
    }
    const playerRules: Record<string, string[]> = {}
    for (const [pid, rules] of this.playerRules) playerRules[pid] = [...rules]

    const sceneVis = this.scene.dumpVisibilityState()

    const collisionState: Record<string, boolean> = {}
    for (const [gid, solid] of this.physics.getCollisionStateSnapshot()) collisionState[gid] = solid

    const playerCollisionOverride: Record<string, Record<string, boolean>> = {}
    for (const pid of this.players.keys()) {
      const m = this.physics.getPlayerCollisionSnapshot(pid)
      const o: Record<string, boolean> = {}
      for (const [gid, v] of m) o[gid] = v
      playerCollisionOverride[pid] = o
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

    return {
      disabledEvents: [...this.disabledEvents],
      mapInstanceIds: this.roomManager.getMapInstanceIds(),
      players,
      playerRules,
      playerRoom: sceneVis.playerRoom,
      playerAccessibleRoomsOverride: sceneVis.playerAccessibleRoomsOverride,
      connections: this.roomManager.getConnectionsSnapshot(),
      geometryState: collisionState,
      playerGeomOverride: playerCollisionOverride,
      globalEntityVisible: sceneVis.globalEntityVisible,
      playerEntityVisible: sceneVis.playerEntityVisible,
      touchingPairs: [...this.touchingPairs],
      moveQueue,
      buttonConfigs,
      buttonStates,
      buttonOccupants,
      buttonCooldownFireAtTick,
      activeVoteRegions: [...this.activeVoteRegions],
      playerVoteRegion,
      globalRoomVisible: sceneVis.globalRoomVisible,
      playerRoomVisible: sceneVis.playerRoomVisible,
    }
  }

  restoreState(dump: WorldDump, mapsByInstance: Map<string, GameMap>): void {
    if (this.players.size > 0 || this.roomManager.getMapInstanceIds().length > 0) {
      throw new Error('World.restoreState called on a non-empty World')
    }
    for (const mid of dump.mapInstanceIds) {
      const map = mapsByInstance.get(mid)
      if (!map) throw new Error(`World.restoreState: missing GameMap for instance '${mid}'`)
      this.addMap(map)
    }
    this.roomManager.applyConnectionsSnapshot(dump.connections)
    this.physics.applyCollisionState(dump.geometryState)

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
    // Restore visibility-side state via Scene; collision-side via Physics.
    this.scene.restoreVisibilityState({
      globalRoomVisible: dump.globalRoomVisible,
      playerRoomVisible: dump.playerRoomVisible,
      // Older dumps may not carry the entity-visibility split. Default to
      // empty maps when missing — the renderer will fall back to "visible".
      globalEntityVisible: dump.globalEntityVisible ?? {},
      playerEntityVisible: dump.playerEntityVisible ?? {},
      playerAccessibleRoomsOverride: dump.playerAccessibleRoomsOverride,
      playerRoom: dump.playerRoom,
    })
    for (const [pid, overrides] of Object.entries(dump.playerGeomOverride)) {
      this.physics.applyPlayerCollisionOverride(pid, overrides)
    }
    for (const key of dump.touchingPairs) this.touchingPairs.add(key)
    for (const [pid, inputs] of Object.entries(dump.moveQueue)) {
      this.moveQueue.set(pid, inputs.map(i => ({ jx: i.jx, jz: i.jz, dt: i.dt })))
    }
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
    for (const rid of dump.activeVoteRegions) this.activeVoteRegions.add(rid)
    for (const [pid, rid] of Object.entries(dump.playerVoteRegion)) {
      this.playerVoteRegion.set(pid, rid)
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  // The list of geometry ids currently registered in Physics. Used to
  // compute the per-map geometryIds set when adding a map.
  private collectGeometryIds(): string[] {
    return [...this.physics.getCollisionStateSnapshot().keys()]
  }

  resolveRoomSticky(prevRoomId: string | null, x: number, z: number): string | null {
    return this.scene.resolveRoomSticky(prevRoomId, x, z)
  }

  advancePlayerRoom(playerId: string): string | null {
    return this.scene.advancePlayerRoom(playerId, (id) => {
      const p = this.players.get(id); return p ? { x: p.x, z: p.z } : undefined
    })
  }

  isRoomOffForPlayer(playerId: string, scopedRoomId: string): boolean {
    return this.scene.isRoomOffForPlayer(playerId, scopedRoomId, (id) => {
      const p = this.players.get(id); return p ? { x: p.x, z: p.z } : undefined
    })
  }
}
