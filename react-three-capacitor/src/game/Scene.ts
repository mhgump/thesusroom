import type { CameraConstraintShapes } from './CameraConstraint.js'
import { doorSegment } from './CameraConstraint.js'
import type { RoomBounds, WorldEvent, WorldMapInstance, WorldRoomView } from './World.js'
import type { GameMap } from './GameMap.js'
import type { RoomSpec, Wall } from './RoomSpec.js'
import type { TransitionRegion } from './WorldSpec.js'
import { RoomManager } from './RoomManager.js'
import type { Physics } from './Physics.js'
import { CAPSULE_RADIUS } from './Physics.js'

const MOVE_SPEED = 0.645

// ── Types ────────────────────────────────────────────────────────────────────

// Result of `toggleRoomOff`. Per spec: "Player can not enter this room
// (function fails if player is in room)". We use a result type rather than
// throwing so callers can branch on the failure cleanly.
export type ToggleRoomResult = { ok: true } | { ok: false; reason: 'player-in-room' }

// Result of `toggleEntityVisibilityOn/Off`. The room name is a sanity-check
// argument — if the entity doesn't actually live in that room, we reject.
export type ToggleEntityVisibilityResult = { ok: true } | { ok: false; reason: 'entity-not-in-room' }

// Result of `processMove`. Mirrors what World.processMove used to return: a
// list of player-scoped events plus the resolved post-move position. Scene
// returns events; the caller (World facade or Room.ts) is responsible for
// fanning them out on the wire.
export interface ProcessMoveResult {
  events: WorldEvent[]
}

// ── Scene class ──────────────────────────────────────────────────────────────

// Scene owns:
//   - the RoomManager (room graph, AABBs, camera shapes, geometry-room map)
//   - per-player visibility state for ROOMS (globalRoomVisible,
//     playerRoomVisible, playerAccessibleRoomsOverride)
//   - per-player visibility state for ENTITIES (globalEntityVisible,
//     playerEntityVisible) — split out of the legacy `geometryState` /
//     `playerGeomOverride` (which were collision-flavoured names but did
//     double duty for visibility)
//   - the per-player current-room map (playerRoom)
//   - the Physics class (which Scene calls into for movement / overlap)
//
// Scene is NOT a React component. The existing GameScene.tsx remains the
// React adapter; it talks to Scene through the World facade.
//
// Movement orchestration lives here because Scene knows the visibility +
// adjacency state needed to compose the passability resolver Physics needs.
// Physics keeps the raw Rapier mechanics; Scene composes the rules.
export class Scene {
  private readonly roomManager: RoomManager
  private readonly physics: Physics

  // Player-scoped current-room map. The "sticky" rule keeps a player in the
  // same room when stepping into an overlap zone — see resolveRoomSticky.
  private readonly playerRoom: Map<string, string | null> = new Map()

  // Per-player override of accessible rooms (scoped ids). When set, replaces
  // the default `{currentRoom} ∪ connections(currentRoom)` derivation. This
  // is the data backing `toggleRoomOn/Off`'s "player can not enter" rule.
  private readonly playerAccessibleRoomsOverride: Map<string, Set<string>> = new Map()

  // Room visibility state. `globalRoomVisible[id] === false` means the room
  // is hidden globally; `playerRoomVisible[pid]?.get(id) === false` means it
  // is hidden for that player specifically. Per-player overrides take
  // precedence over the global setting.
  private readonly globalRoomVisible: Map<string, boolean> = new Map()
  private readonly playerRoomVisible: Map<string, Map<string, boolean>> = new Map()

  // Entity (geometry) visibility state. Split out of the legacy combined
  // `geometryState` / `playerGeomOverride` maps. After the visibility/
  // collision split, these maps drive ONLY the renderer (and the per-player
  // room-off gate during processMove); collision is owned by Physics.
  private readonly globalEntityVisible: Map<string, boolean> = new Map()
  private readonly playerEntityVisible: Map<string, Map<string, boolean>> = new Map()

  // Queue of world-level events produced between processTick() calls. The
  // Scene's setRoomVisible / toggleRoom* / toggleEntityVisibility* APIs
  // append here; processTick (the World facade) drains them.
  private pendingGlobalEvents: WorldEvent[] = []

  constructor(roomManager: RoomManager, physics: Physics) {
    this.roomManager = roomManager
    this.physics = physics
  }

  // ── Room-manager passthroughs (kept for caller convenience) ────────────────

  getRoomManager(): RoomManager { return this.roomManager }

  // ── Per-player room tracking ───────────────────────────────────────────────

  getPlayerRoom(playerId: string): string | null {
    return this.playerRoom.get(playerId) ?? null
  }

  setPlayerRoom(playerId: string, scopedRoomId: string | null): void {
    this.playerRoom.set(playerId, scopedRoomId)
  }

  // The set of rooms a player may currently be in. Resolution order:
  //   1. per-player override, if set — used as-is
  //   2. else {currentRoom} ∪ enabled-connections(currentRoom)
  getAccessibleRooms(
    playerId: string,
    getPlayerPos: (id: string) => { x: number; z: number } | undefined,
  ): Set<string> {
    const override = this.playerAccessibleRoomsOverride.get(playerId)
    if (override) return new Set(override)

    const current = this.resolveCurrentRoom(playerId, getPlayerPos)
    if (!current) return new Set()
    const out = new Set<string>([current])
    for (const n of this.roomManager.getAdjacentRoomIds(current)) out.add(n)
    return out
  }

  setAccessibleRoomsOverride(playerId: string, scopedRoomIds: string[] | null): void {
    if (scopedRoomIds === null) this.playerAccessibleRoomsOverride.delete(playerId)
    else this.playerAccessibleRoomsOverride.set(playerId, new Set(scopedRoomIds))
  }

  getPlayerAccessibleRoomsOverride(playerId: string): string[] | null {
    const set = this.playerAccessibleRoomsOverride.get(playerId)
    return set ? [...set] : null
  }

  // ── Room visibility (legacy setRoomVisible) ────────────────────────────────

  // Show or hide a set of rooms. When `playerIds` is supplied the change is
  // per-player; otherwise it is global. Mirrors the legacy `World.setRoomVisible`
  // behaviour exactly so existing callers (Scenario, scenarios) are unaffected.
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

  // ── Combined room-on/off (Task 3 spec) ─────────────────────────────────────

  // Enable a room: visible and accessible. `playerId` undefined = global.
  // For per-player calls, drops any "off" override so the player can re-enter.
  toggleRoomOn(roomName: string, playerId?: string): ToggleRoomResult {
    if (playerId === undefined) {
      this.globalRoomVisible.set(roomName, true)
      this.pendingGlobalEvents.push({
        type: 'room_visibility_change',
        scope: 'all',
        updates: [{ roomId: roomName, visible: true }],
      })
      return { ok: true }
    }
    let m = this.playerRoomVisible.get(playerId)
    if (!m) { m = new Map(); this.playerRoomVisible.set(playerId, m) }
    m.set(roomName, true)
    const override = this.playerAccessibleRoomsOverride.get(playerId)
    if (override) override.add(roomName)
    this.pendingGlobalEvents.push({
      type: 'room_visibility_change',
      scope: { playerIds: [playerId] },
      updates: [{ roomId: roomName, visible: true }],
    })
    return { ok: true }
  }

  // Disable a room: invisible AND inaccessible. Per spec this fails when the
  // target player is currently in that room (you can't kick a player out by
  // toggling the room off).
  toggleRoomOff(roomName: string, playerId?: string): ToggleRoomResult {
    if (playerId !== undefined) {
      if (this.playerRoom.get(playerId) === roomName) {
        return { ok: false, reason: 'player-in-room' }
      }
      let m = this.playerRoomVisible.get(playerId)
      if (!m) { m = new Map(); this.playerRoomVisible.set(playerId, m) }
      m.set(roomName, false)
      // Strip the room from the player's accessible set (creating a new
      // override if the player previously had none).
      let override = this.playerAccessibleRoomsOverride.get(playerId)
      if (!override) {
        // Default = current room ∪ adjacent. We can only honour this if we
        // know the current room, else fall back to "everything but this room".
        const current = this.playerRoom.get(playerId)
        const allowed = new Set<string>()
        if (current) {
          allowed.add(current)
          for (const n of this.roomManager.getAdjacentRoomIds(current)) allowed.add(n)
        }
        allowed.delete(roomName)
        override = allowed
        this.playerAccessibleRoomsOverride.set(playerId, override)
      } else {
        override.delete(roomName)
      }
      this.pendingGlobalEvents.push({
        type: 'room_visibility_change',
        scope: { playerIds: [playerId] },
        updates: [{ roomId: roomName, visible: false }],
      })
      return { ok: true }
    }
    // Global toggle-off: refuse if ANY tracked player is currently in the room.
    for (const [pid, rid] of this.playerRoom) {
      if (rid === roomName) {
        // playerId is unused in this branch; the failure is global.
        void pid
        return { ok: false, reason: 'player-in-room' }
      }
    }
    this.globalRoomVisible.set(roomName, false)
    this.pendingGlobalEvents.push({
      type: 'room_visibility_change',
      scope: 'all',
      updates: [{ roomId: roomName, visible: false }],
    })
    return { ok: true }
  }

  // ── Entity (geometry) visibility ───────────────────────────────────────────

  // Make an entity visible. `roomName` is a sanity check — the entity must
  // belong to that room or we reject. `playerId` undefined = global.
  toggleEntityVisibilityOn(roomName: string, entityId: string, playerId?: string): ToggleEntityVisibilityResult {
    if (this.roomManager.getGeometryRoomId(entityId) !== roomName) {
      return { ok: false, reason: 'entity-not-in-room' }
    }
    if (playerId !== undefined) {
      let m = this.playerEntityVisible.get(playerId)
      if (!m) { m = new Map(); this.playerEntityVisible.set(playerId, m) }
      m.set(entityId, true)
    } else {
      this.globalEntityVisible.set(entityId, true)
    }
    return { ok: true }
  }

  // Make an entity invisible. ONLY flips visibility; does not touch collision.
  toggleEntityVisibilityOff(roomName: string, entityId: string, playerId?: string): ToggleEntityVisibilityResult {
    if (this.roomManager.getGeometryRoomId(entityId) !== roomName) {
      return { ok: false, reason: 'entity-not-in-room' }
    }
    if (playerId !== undefined) {
      let m = this.playerEntityVisible.get(playerId)
      if (!m) { m = new Map(); this.playerEntityVisible.set(playerId, m) }
      m.set(entityId, false)
    } else {
      this.globalEntityVisible.set(entityId, false)
    }
    return { ok: true }
  }

  // Loose entity-visibility setters used by the legacy (deprecated)
  // `toggleGeometryOn/Off` convenience on World. These bypass the room-name
  // sanity check because the legacy callers don't have the room name handy
  // (and the geometry id is globally unique so there's no real ambiguity).
  setEntityVisibleLegacy(entityId: string, visible: boolean, playerId?: string): void {
    if (playerId !== undefined) {
      let m = this.playerEntityVisible.get(playerId)
      if (!m) { m = new Map(); this.playerEntityVisible.set(playerId, m) }
      m.set(entityId, visible)
    } else {
      this.globalEntityVisible.set(entityId, visible)
    }
  }

  // ── Per-map visibility query ───────────────────────────────────────────────

  // Returns true iff at least one room in `mapInstanceId` is visible from
  // `playerId`'s perspective — using the same precedence rule the renderer
  // uses (per-player override beats global; default = visible). Used by the
  // wire-filter on `map_add` / `world_reset` so a player who has every room
  // of a map toggled off doesn't receive the map's geometry/topology on the
  // wire. The room-visibility version of "is this map relevant to this
  // player at all".
  playerHasMapVisible(playerId: string, mapInstanceId: string): boolean {
    const scopedIds = this.roomManager.getRoomsInMapInstance(mapInstanceId)
    if (scopedIds.length === 0) return false
    const pVis = this.playerRoomVisible.get(playerId)
    for (const sid of scopedIds) {
      const override = pVis?.get(sid)
      if (override !== undefined) {
        if (override) return true
        continue
      }
      // No per-player override — fall back to global (default true).
      if (this.globalRoomVisible.get(sid) !== false) return true
    }
    return false
  }

  // ── Snapshots ──────────────────────────────────────────────────────────────

  getGlobalRoomVisibility(): Map<string, boolean> { return new Map(this.globalRoomVisible) }
  getPlayerRoomVisibility(playerId: string): Map<string, boolean> {
    return new Map(this.playerRoomVisible.get(playerId) ?? [])
  }
  getGlobalEntityVisibility(): Map<string, boolean> { return new Map(this.globalEntityVisible) }
  getPlayerEntityVisibility(playerId: string): Map<string, boolean> {
    return new Map(this.playerEntityVisible.get(playerId) ?? [])
  }

  // ── Lifecycle / cleanup ────────────────────────────────────────────────────

  // Drop all per-player state for a removed player. Called from the World
  // facade as part of removePlayer.
  removePlayer(playerId: string): void {
    this.playerRoom.delete(playerId)
    this.playerAccessibleRoomsOverride.delete(playerId)
    this.playerRoomVisible.delete(playerId)
    this.playerEntityVisible.delete(playerId)
  }

  // Cleanup hooks called by the World facade when a map is removed.
  onMapRemoved(removedScopedRoomIds: Set<string>, removedGeometryIds: Set<string>): void {
    for (const sid of removedScopedRoomIds) {
      this.globalRoomVisible.delete(sid)
    }
    for (const m of this.playerRoomVisible.values()) {
      for (const sid of removedScopedRoomIds) m.delete(sid)
    }
    for (const set of this.playerAccessibleRoomsOverride.values()) {
      for (const sid of removedScopedRoomIds) set.delete(sid)
    }
    for (const [pid, rid] of this.playerRoom) {
      if (rid && removedScopedRoomIds.has(rid)) this.playerRoom.set(pid, null)
    }
    for (const gid of removedGeometryIds) this.globalEntityVisible.delete(gid)
    for (const m of this.playerEntityVisible.values()) {
      for (const gid of removedGeometryIds) m.delete(gid)
    }
  }

  // ── Pending event drains ───────────────────────────────────────────────────

  drainPendingGlobalEvents(): WorldEvent[] {
    const out = this.pendingGlobalEvents
    this.pendingGlobalEvents = []
    return out
  }

  clearPendingGlobalEvents(): void { this.pendingGlobalEvents = [] }

  // Unicast append (used by toggle callers) — no separate API; pendingGlobalEvents
  // is already the right channel and the World facade pulls from it during
  // processTick + drainPendingGlobalEvents.

  // ── Movement (per-tick) ────────────────────────────────────────────────────

  // Whether a room is "off" (invisible + non-collidable) for `playerId`.
  // Precedence (highest first):
  //   1. explicit per-player room visibility override
  //   2. auto-hide for overlapping rooms that aren't the player's current
  //      room (the renderer relies on the invariant "every room overlapping
  //      the current one is off")
  //   3. global room visibility (default: on)
  isRoomOffForPlayer(playerId: string, scopedRoomId: string, getPlayerPos: (id: string) => { x: number; z: number } | undefined): boolean {
    const pOverride = this.playerRoomVisible.get(playerId)?.get(scopedRoomId)
    if (pOverride !== undefined) return !pOverride
    if (this.roomManager.isRoomOverlapping(scopedRoomId)) {
      const current = this.resolveCurrentRoom(playerId, getPlayerPos)
      if (scopedRoomId !== current) return true
    }
    return this.globalRoomVisible.get(scopedRoomId) === false
  }

  // Higher-level processMove that composes Physics + per-player visibility +
  // stay-in-rooms + advancePlayerRoom. Mirrors the legacy World.processMove
  // 1:1 and takes a player accessor instead of holding player state directly
  // (players still live on World — see World.players for the rationale).
  processMove(
    playerId: string,
    jx: number,
    jz: number,
    dt: number,
    accessors: {
      getPlayer: (id: string) => { x: number; z: number; vx: number; vz: number } | undefined
      writePlayerPos: (id: string, x: number, z: number, prevX: number, prevZ: number) => void
      animationStateUpdate: (id: string, jx: number, jz: number) => WorldEvent | null
      touchUpdate: (id: string) => WorldEvent[]
    },
  ): ProcessMoveResult {
    const player = accessors.getPlayer(playerId)
    if (!player) return { events: [] }
    const events: WorldEvent[] = []
    const safeDt = Math.min(dt, 0.1)

    // Resolve passability with the live `getPlayer` accessor instead of the
    // closure-bound passabilityResolver field (which uses the room-off path
    // without per-player position lookup).
    const getPosForRoomLookup = (id: string) => {
      const p = accessors.getPlayer(id); return p ? { x: p.x, z: p.z } : undefined
    }
    const passability = (pid: string, gid: string): boolean => {
      const pVis = this.playerEntityVisible.get(pid)
      const visEff = pVis?.has(gid) ? pVis.get(gid)! : (this.globalEntityVisible.get(gid) ?? true)
      if (!visEff) return true
      if (!this.physics.isCollisionSolidForPlayer(pid, gid)) return true
      const rid = this.roomManager.getGeometryRoomId(gid)
      return rid ? this.isRoomOffForPlayer(pid, rid, getPosForRoomLookup) : false
    }

    const desiredX = jx * MOVE_SPEED * safeDt
    const desiredZ = jz * MOVE_SPEED * safeDt
    const { dx, dz } = this.physics.computeColliderMovement(playerId, desiredX, desiredZ, passability)

    const prevX = player.x
    const prevZ = player.z
    let nx = player.x + dx
    let nz = player.z + dz

    // Stay-in-rooms + connection-gap: a candidate post-move position is legal
    // when (a) it lies in the union of accessible rooms AND (b) if it crosses
    // a wall (changes which room contains the player), it does so through the
    // connection's door segment. If not, try keeping each axis individually,
    // then full revert — the same per-axis fallback pattern the AABB-only
    // check used before Task 5.
    const accessible = this.getAccessibleRooms(playerId, getPosForRoomLookup)
    const legal = (cx: number, cz: number) => {
      if (accessible.size > 0 && !this.isInRoomSet(cx, cz, accessible)) return false
      return this.isCrossingThroughDoor(prevX, prevZ, cx, cz)
    }
    if (!legal(nx, nz)) {
      if (legal(nx, prevZ)) { nz = prevZ }
      else if (legal(prevX, nz)) { nx = prevX }
      else { nx = prevX; nz = prevZ }
    }

    accessors.writePlayerPos(playerId, nx, nz, prevX, prevZ)
    this.physics.setPlayerPosition(playerId, nx, nz)

    // Maintain the sticky playerRoom mapping; downstream events come from
    // the caller's accessors.
    this.advancePlayerRoom(playerId, getPosForRoomLookup)

    const animEv = accessors.animationStateUpdate(playerId, jx, jz)
    if (animEv) events.push(animEv)
    const touchEvs = accessors.touchUpdate(playerId)
    for (const e of touchEvs) events.push(e)

    return { events }
  }

  // Pre-tick / queued helpers used by the World facade to compose its full
  // processTick result.
  pendingEventsCount(): number { return this.pendingGlobalEvents.length }

  // ── Sticky room resolution ─────────────────────────────────────────────────

  resolveRoomSticky(prevRoomId: string | null, x: number, z: number): string | null {
    if (prevRoomId) {
      const b = this.roomManager.getRoomBounds(prevRoomId)
      if (b && Math.abs(x - b.cx) <= b.hw && Math.abs(z - b.cz) <= b.hd) return prevRoomId
      for (const nid of this.roomManager.getAdjacentRoomIds(prevRoomId)) {
        const nb = this.roomManager.getRoomBounds(nid)
        if (nb && Math.abs(x - nb.cx) <= nb.hw && Math.abs(z - nb.cz) <= nb.hd) return nid
      }
    }
    return this.roomManager.getRoomAtPosition(x, z)
  }

  advancePlayerRoom(playerId: string, getPlayerPos: (id: string) => { x: number; z: number } | undefined): string | null {
    const p = getPlayerPos(playerId)
    if (!p) return null
    const prev = this.playerRoom.get(playerId) ?? null
    const next = this.resolveRoomSticky(prev, p.x, p.z)
    if (next !== prev) this.playerRoom.set(playerId, next)
    return next
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  resolveCurrentRoom(playerId: string, getPlayerPos: (id: string) => { x: number; z: number } | undefined): string | null {
    const stored = this.playerRoom.get(playerId)
    if (stored) return stored
    const p = getPlayerPos(playerId)
    if (!p) return null
    let found: string | null = null
    this.roomManager.forEachRoomBounds((scopedId, b) => {
      if (found) return
      if (Math.abs(p.x - b.cx) <= b.hw && Math.abs(p.z - b.cz) <= b.hd) found = scopedId
    })
    return found
  }

  isInRoomSet(x: number, z: number, rooms: Set<string>): boolean {
    for (const id of rooms) {
      const b = this.roomManager.getRoomBounds(id)
      if (!b) continue
      if (Math.abs(x - b.cx) <= b.hw && Math.abs(z - b.cz) <= b.hd) return true
    }
    return false
  }

  // Connection-gap check: when a move from (prevX,prevZ) → (nx,nz) crosses a
  // room boundary, accept only if the crossing point falls inside the door
  // segment of the connection between the two rooms. Returns true when:
  //   - prev and next rooms are the same (no wall crossed), OR
  //   - prev room is unknown (no positioned player yet), OR
  //   - a connection between prev and next exists AND the crossing point on
  //     the shared wall lies within the door's `length` span.
  // Returns false when:
  //   - the move enters a different room without an installed connection, OR
  //   - the connection exists but the crossing is OUTSIDE the door span.
  // (When prev and next are the same, this is a no-op — solid walls inside a
  // room are still blocked by Rapier; this method runs AFTER Rapier's move.)
  isCrossingThroughDoor(prevX: number, prevZ: number, nx: number, nz: number): boolean {
    const prevRoomId = this.roomManager.getRoomAtPosition(prevX, prevZ)
    if (!prevRoomId) return true  // no current room: skip the gate
    const nextRoomId = this.roomManager.getRoomAtPosition(nx, nz)
    if (nextRoomId === null) return true  // outside any room: AABB check rejects this anyway
    if (nextRoomId === prevRoomId) return true  // no wall crossed
    const record = this.roomManager.getConnectionBetween(prevRoomId, nextRoomId)
    if (!record) return false  // moves into a non-adjacent room are not allowed
    const prevView = this.roomManager.getRoomByScopedId(prevRoomId)
    if (!prevView) return false
    const sideForPrev = this.roomManager.getConnectionSideForRoom(record, prevRoomId)
    if (!sideForPrev) return false
    return crossingPointInDoorSpan(prevX, prevZ, nx, nz, prevView.room, prevView.worldPos, sideForPrev)
  }

  // ── Dump / restore helpers ─────────────────────────────────────────────────

  dumpVisibilityState(): {
    globalRoomVisible: Record<string, boolean>
    playerRoomVisible: Record<string, Record<string, boolean>>
    globalEntityVisible: Record<string, boolean>
    playerEntityVisible: Record<string, Record<string, boolean>>
    playerAccessibleRoomsOverride: Record<string, string[]>
    playerRoom: Record<string, string | null>
  } {
    const globalRoomVisible: Record<string, boolean> = {}
    for (const [rid, visible] of this.globalRoomVisible) globalRoomVisible[rid] = visible
    const playerRoomVisible: Record<string, Record<string, boolean>> = {}
    for (const [pid, m] of this.playerRoomVisible) {
      const o: Record<string, boolean> = {}
      for (const [rid, v] of m) o[rid] = v
      playerRoomVisible[pid] = o
    }
    const globalEntityVisible: Record<string, boolean> = {}
    for (const [gid, v] of this.globalEntityVisible) globalEntityVisible[gid] = v
    const playerEntityVisible: Record<string, Record<string, boolean>> = {}
    for (const [pid, m] of this.playerEntityVisible) {
      const o: Record<string, boolean> = {}
      for (const [gid, v] of m) o[gid] = v
      playerEntityVisible[pid] = o
    }
    const playerAccessibleRoomsOverride: Record<string, string[]> = {}
    for (const [pid, set] of this.playerAccessibleRoomsOverride) {
      playerAccessibleRoomsOverride[pid] = [...set]
    }
    const playerRoom: Record<string, string | null> = {}
    for (const [pid, rid] of this.playerRoom) playerRoom[pid] = rid
    return {
      globalRoomVisible,
      playerRoomVisible,
      globalEntityVisible,
      playerEntityVisible,
      playerAccessibleRoomsOverride,
      playerRoom,
    }
  }

  restoreVisibilityState(dump: {
    globalRoomVisible: Record<string, boolean>
    playerRoomVisible: Record<string, Record<string, boolean>>
    globalEntityVisible: Record<string, boolean>
    playerEntityVisible: Record<string, Record<string, boolean>>
    playerAccessibleRoomsOverride: Record<string, string[]>
    playerRoom: Record<string, string | null>
  }): void {
    for (const [rid, v] of Object.entries(dump.globalRoomVisible)) this.globalRoomVisible.set(rid, v)
    for (const [pid, overrides] of Object.entries(dump.playerRoomVisible)) {
      const m = new Map<string, boolean>()
      for (const [rid, v] of Object.entries(overrides)) m.set(rid, v)
      this.playerRoomVisible.set(pid, m)
    }
    for (const [gid, v] of Object.entries(dump.globalEntityVisible)) this.globalEntityVisible.set(gid, v)
    for (const [pid, overrides] of Object.entries(dump.playerEntityVisible)) {
      const m = new Map<string, boolean>()
      for (const [gid, v] of Object.entries(overrides)) m.set(gid, v)
      this.playerEntityVisible.set(pid, m)
    }
    for (const [pid, ids] of Object.entries(dump.playerAccessibleRoomsOverride)) {
      this.playerAccessibleRoomsOverride.set(pid, new Set(ids))
    }
    for (const [pid, rid] of Object.entries(dump.playerRoom)) {
      this.playerRoom.set(pid, rid)
    }
  }
}

// Test whether the segment (prevX,prevZ) → (nx,nz) crosses `prevRoom`'s wall
// at a point inside the door's `length` span. The wall is axis-aligned (N/S
// at fixed z, E/W at fixed x), derived from the connection side. Uses the
// same `doorSegment` math `synthesizeTransitionZones` uses so the door span
// is byte-identical to the camera-zone door endpoints.
//
// Edge cases:
//   - The segment may be exactly tangent to the wall (denom = 0). That only
//     happens when prevX/prevZ have the same coord as nx/nz on the wall axis,
//     which means the move never crosses — a no-op crossing, treated as
//     accept (the room-change must therefore be due to a different wall, but
//     the caller only computes prev/next room transitions, so we don't need
//     to disambiguate further; the AABB check handles non-crossing entries).
//   - The crossing point may be on the boundary of the door span (t exactly
//     at +halfLen or -halfLen). We accept boundary hits — matches the
//     "inclusive AABB" convention of getRoomAtPosition.
function crossingPointInDoorSpan(
  prevX: number, prevZ: number,
  nx: number, nz: number,
  prevRoom: RoomSpec,
  prevPos: { x: number; z: number },
  side: { wall: Wall; length: number; position: number },
): boolean {
  const seg = doorSegment(prevRoom, prevPos, side)
  // The wall is on the axis perpendicular to the parallel direction.
  if (side.wall === 'north' || side.wall === 'south') {
    // Horizontal wall at z = seg.mid.z. Door span: [mid.x - halfDir.x, mid.x + halfDir.x].
    const wallZ = seg.mid.z
    const denom = nz - prevZ
    if (denom === 0) return true  // tangent: caller's room change must be elsewhere; accept
    const t = (wallZ - prevZ) / denom
    if (t < 0 || t > 1) return true  // wall not crossed in this segment
    const crossX = prevX + t * (nx - prevX)
    const halfLen = Math.abs(seg.halfDir.x)
    const eps = 1e-9
    return crossX >= seg.mid.x - halfLen - eps && crossX <= seg.mid.x + halfLen + eps
  } else {
    // Vertical wall at x = seg.mid.x. Door span: [mid.z - halfDir.z, mid.z + halfDir.z].
    const wallX = seg.mid.x
    const denom = nx - prevX
    if (denom === 0) return true
    const t = (wallX - prevX) / denom
    if (t < 0 || t > 1) return true
    const crossZ = prevZ + t * (nz - prevZ)
    const halfLen = Math.abs(seg.halfDir.z)
    const eps = 1e-9
    return crossZ >= seg.mid.z - halfLen - eps && crossZ <= seg.mid.z + halfLen + eps
  }
}

// Re-exports so callers that already import from World keep working with a
// minimum of churn. (RoomBounds + WorldEvent are already exported from
// World.ts; we re-export them here for the unusual case of someone wanting
// to pull Scene-level types without going through World.)
export type { CameraConstraintShapes, RoomBounds, WorldRoomView, WorldMapInstance, GameMap, RoomSpec, Wall, TransitionRegion }
// CAPSULE_RADIUS lives on Physics; re-export so Scene's caller can read it.
export { CAPSULE_RADIUS }
