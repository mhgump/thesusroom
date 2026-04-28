import { buildMapInstanceArtifacts, type FlattenedGeometry, type MapInstanceArtifacts } from './MapInstance.js'
import type { GameMap } from './GameMap.js'
import type { RoomSpec, Wall } from './RoomSpec.js'
import type { RoomConnection, RoomConnectionSide, RoomWorldPos, TransitionRegion, WorldSpec } from './WorldSpec.js'
import { computeRoomPositions, scopedRoomId } from './WorldSpec.js'
import { buildCameraConstraintShapes, type CameraConstraintShapes, type CameraRect, type CameraZone } from './CameraConstraint.js'
import type { RoomBounds, WorldMapInstance, WorldRoomView } from './World.js'

// ── Internal types ───────────────────────────────────────────────────────────

// A connection edge record kept in RoomManager so movement code (Task 5's
// connection-gap check) can look up the per-side door geometry between two
// scoped rooms in O(1). The same record covers map-internal connections (from
// `map.connections`) and cross-instance connections (added by `addRoom` /
// `attachMap`) — both go through `addConnectionRecord` at install time.
//
// `sideForRoom` resolves the door side (`wall`/`length`/`position`/
// `transitionRegion`) belonging to a given scoped room id, since the record
// stores them under stable A/B keys (canonical sort by scoped id).
export interface ConnectionRecord {
  scopedRoomIdA: string
  scopedRoomIdB: string
  sideA: RoomConnectionSide
  sideB: RoomConnectionSide
}

// Per-map-instance bookkeeping owned by the RoomManager. Mirrors what
// World.WorldMapInstanceInternal used to hold, minus the button/voteRegion
// ids (those are still owned by World until Task 3 splits them out).
interface RoomManagerMapInstance {
  mapInstanceId: string
  scopedRoomIds: string[]
  // The currently-attached spec. For mutable instances (rooms added via
  // `addRoom`), this is rebuilt on every mutation. For immutable instances
  // (the result of plain `addMap`), this is the original GameMap.
  source: 'map' | 'synthetic'
  map: GameMap | null
  rooms: WorldRoomView[]
  geometryIds: string[]
  cameraShapes: CameraConstraintShapes
  artifacts: MapInstanceArtifacts
}

// Adapter that lets RoomManager defer Rapier collider lifecycle to World
// (which still owns Rapier in this task). RoomManager hands the adapter the
// flattened geometry pieces it computed and the adapter installs them. On
// teardown, RoomManager hands back the geometry ids it wants removed.
export interface PhysicsAdapter {
  addGeometry(geom: FlattenedGeometry): void
  removeGeometry(geomId: string): void
}

// ── RoomManager ──────────────────────────────────────────────────────────────

// Owns the room-graph + map-instance state that World used to carry inline.
// World keeps a `roomManager: RoomManager` field and exposes thin delegating
// wrappers so existing callsites keep working unchanged.
//
// What lives here:
//   - mapInstances, roomViewByScopedId, overlappingRoomIds
//   - per-room world-space AABBs (roomBounds)
//   - the symmetric adjacency Map<string, Set<string>> (connections)
//   - changeSubscribers + mapsVersion bump on every mutation
//   - per-map camera shapes (the union returned by getCameraShapes)
//   - geometry → owning room id (so World can gate per-player visibility on it)
//
// What does NOT live here (still on World):
//   - Rapier colliders / KinematicCharacterController / players
//   - button / vote-region runtime state
//   - per-player geometry / room visibility overlays
export class RoomManager {
  private readonly mapInstances: Map<string, RoomManagerMapInstance> = new Map()
  private readonly roomViewByScopedId: Map<string, WorldRoomView> = new Map()
  private readonly overlappingRoomIds: Set<string> = new Set()
  private readonly roomBounds: Map<string, RoomBounds> = new Map()
  private readonly connections: Map<string, Set<string>> = new Map()
  // Per-edge connection record (door wall + length + position for each side).
  // Keyed by the canonical pair key `min(a,b)|max(a,b)`. Populated alongside
  // `connections` by addMap/addRoom/attachMap and torn down by removeMap /
  // removeRoom. `setConnectionEnabled(false)` does NOT delete the record —
  // adjacency is gone but the door geometry is preserved for re-enable.
  private readonly connectionRecords: Map<string, ConnectionRecord> = new Map()
  // Geometry id → owning scoped room id. Populated by addMap/addRoom/attachMap;
  // World reads it via `getGeometryRoomId` to gate per-player room visibility
  // against the geometry collider list.
  private readonly geometryRoomId: Map<string, string> = new Map()
  // Geometry id → flattened world-space AABB. Kept so saveAsMapSpec can
  // reconstruct a per-room GeometrySpec list and removeRoom can iterate the
  // pieces a room owns without rescanning every map instance.
  private readonly flattenedGeometry: Map<string, FlattenedGeometry> = new Map()

  private readonly changeSubscribers: Set<() => void> = new Set()
  private mapsVersion = 0

  // ── Map registration ───────────────────────────────────────────────────────

  // Standalone-placement: the GameMap is laid out independently of any
  // existing instance. Mirrors the legacy `World.addMap(map)` behavior exactly.
  addMap(map: GameMap, physics: PhysicsAdapter): WorldMapInstance {
    const artifacts = buildMapInstanceArtifacts(map, map.mapInstanceId)
    return this.installMapInstance(map, map.mapInstanceId, artifacts, physics)
  }

  // Graft an entire GameMap onto an existing room. The map is repositioned so
  // that `args.mapRoomId` sits adjacent to `args.targetRoomScopedId` along the
  // wall described by the two connection sides. The remaining rooms in the
  // grafted map BFS from `mapRoomId` per the map's own internal connections.
  //
  // Implementation note: we reuse buildMapInstanceArtifacts on a synthetic
  // WorldSpec whose `origin` pre-positions `mapRoomId` next to the target, so
  // computeRoomPositions does the BFS the same way the standalone path does.
  // The new cross-instance edge (target↔mapRoom) is added to the symmetric
  // adjacency directly — it doesn't live on either GameMap's `connections`.
  attachMap(args: {
    map: GameMap
    targetRoomScopedId: string
    connectionAtTarget: { wall: Wall; length: number; position: number; transitionRegion: TransitionRegion }
    mapRoomId: string
    connectionAtMapRoom: { wall: Wall; length: number; position: number; transitionRegion: TransitionRegion }
  }, physics: PhysicsAdapter): WorldMapInstance {
    const targetView = this.roomViewByScopedId.get(args.targetRoomScopedId)
    if (!targetView) throw new Error(`attachMap: unknown target room '${args.targetRoomScopedId}'`)
    const mapRoom = args.map.rooms.find(r => r.id === args.mapRoomId)
    if (!mapRoom) throw new Error(`attachMap: room '${args.mapRoomId}' not found in map '${args.map.id}'`)

    // Place mapRoom such that its connection wall aligns with the target's
    // connection wall. Reuse the same math computeRoomPositions does for any
    // single edge (door centre on the known wall, then back-solve unknown
    // centre from where its wall meets the door).
    const newRoomCenter = computeNeighbourCenter(
      targetView.room, targetView.worldPos, args.connectionAtTarget,
      mapRoom, args.connectionAtMapRoom,
    )

    // Synthesize a WorldSpec where `mapRoom` is rooms[0] so the BFS in
    // computeRoomPositions starts from the placed anchor and walks the rest
    // of the map's internal connections.
    const reorderedRooms = [mapRoom, ...args.map.rooms.filter(r => r.id !== mapRoom.id)]
    const synthSpec: WorldSpec = {
      rooms: reorderedRooms,
      connections: args.map.connections,
      origin: newRoomCenter,
    }
    const artifacts = buildMapInstanceArtifacts(synthSpec, args.map.mapInstanceId)
    const installed = this.installMapInstance(args.map, args.map.mapInstanceId, artifacts, physics)

    // Record the cross-instance adjacency edge.
    const mapRoomScopedId = scopedRoomId(args.map.mapInstanceId, args.mapRoomId)
    this.addConnectionEdge(args.targetRoomScopedId, mapRoomScopedId)
    this.addConnectionRecord(
      args.targetRoomScopedId, args.connectionAtTarget,
      mapRoomScopedId, args.connectionAtMapRoom,
    )
    this.notifyChange()
    return installed
  }

  // Add a single room grafted onto an existing room via a connection. The
  // new room becomes its own throwaway map instance — keeps removeRoom /
  // removeMap orthogonal and avoids mutating an existing GameMap's `rooms`
  // list (which other code may have cached).
  //
  // Returns the scoped id of the new room. The instance id is a synthetic
  // `room_<n>` derived from a counter; callers don't need to know it (the
  // returned scoped id is stable; removeRoom takes the scoped id directly).
  addRoom(args: {
    targetRoomScopedId: string
    connectionAtTarget: { wall: Wall; length: number; position: number; transitionRegion: TransitionRegion }
    connectionAtNew: { wall: Wall; length: number; position: number; transitionRegion: TransitionRegion }
    newRoom: RoomSpec
  }, physics: PhysicsAdapter): { scopedRoomId: string } {
    const targetView = this.roomViewByScopedId.get(args.targetRoomScopedId)
    if (!targetView) throw new Error(`addRoom: unknown target room '${args.targetRoomScopedId}'`)

    const newRoomCenter = computeNeighbourCenter(
      targetView.room, targetView.worldPos, args.connectionAtTarget,
      args.newRoom, args.connectionAtNew,
    )

    const synthInstanceId = this.nextSyntheticInstanceId()
    // A throwaway one-room WorldSpec at the computed origin.
    const synthSpec: WorldSpec = {
      rooms: [args.newRoom],
      connections: [],
      origin: newRoomCenter,
    }
    const artifacts = buildMapInstanceArtifacts(synthSpec, synthInstanceId)
    this.installSynthetic(synthInstanceId, artifacts, args.newRoom, physics)

    const scoped = scopedRoomId(synthInstanceId, args.newRoom.id)
    this.addConnectionEdge(args.targetRoomScopedId, scoped)
    this.addConnectionRecord(
      args.targetRoomScopedId, args.connectionAtTarget,
      scoped, args.connectionAtNew,
    )
    this.notifyChange()
    return { scopedRoomId: scoped }
  }

  // Remove a previously-added map. Tears down every collider, bound, and
  // adjacency edge the map introduced. Per-player overrides are cleaned up
  // by World (it owns those).
  removeMap(mapInstanceId: string, physics: PhysicsAdapter): { removedScopedRoomIds: string[]; removedGeometryIds: string[] } {
    const instance = this.mapInstances.get(mapInstanceId)
    if (!instance) return { removedScopedRoomIds: [], removedGeometryIds: [] }
    const scoped = new Set(instance.scopedRoomIds)
    const geometryIds = [...instance.geometryIds]

    for (const geomId of geometryIds) {
      physics.removeGeometry(geomId)
      this.geometryRoomId.delete(geomId)
      this.flattenedGeometry.delete(geomId)
    }
    for (const sid of scoped) {
      this.roomBounds.delete(sid)
      this.connections.delete(sid)
      this.roomViewByScopedId.delete(sid)
      this.overlappingRoomIds.delete(sid)
      this.removeConnectionRecordsFor(sid)
    }
    for (const neighbours of this.connections.values()) {
      for (const sid of scoped) neighbours.delete(sid)
    }
    this.mapInstances.delete(mapInstanceId)
    this.notifyChange()
    return { removedScopedRoomIds: [...scoped], removedGeometryIds: geometryIds }
  }

  // Remove a single room. Fails (without mutation) if removing it would
  // disconnect any other room in any map instance from that instance's
  // rooms[0]. Cleans up the room's bounds, views, adjacency edges, and
  // geometry pieces.
  //
  // Reachability rule: every map instance picks its first scoped room id as
  // the "root" — if removing the target room makes any other room in that
  // instance unreachable from its root via the post-removal `connections`
  // graph (limited to that instance's room ids), we refuse. Cross-instance
  // connections (introduced by addRoom / attachMap) are NOT considered for
  // reachability; each instance must stay self-coherent.
  removeRoom(scopedRoomIdToRemove: string, physics: PhysicsAdapter): { ok: true } | { ok: false; reason: 'would-disconnect' | 'not-found' | 'is-root' } {
    const view = this.roomViewByScopedId.get(scopedRoomIdToRemove)
    if (!view) return { ok: false, reason: 'not-found' }
    const instance = this.mapInstances.get(view.mapInstanceId)
    if (!instance) return { ok: false, reason: 'not-found' }
    if (instance.scopedRoomIds[0] === scopedRoomIdToRemove) return { ok: false, reason: 'is-root' }

    // Reachability check on the post-removal graph, restricted to this
    // instance's room ids (cross-instance edges aren't load-bearing for
    // intra-map BFS).
    const remaining = instance.scopedRoomIds.filter(id => id !== scopedRoomIdToRemove)
    const root = instance.scopedRoomIds[0]
    const reachable = new Set<string>([root])
    const queue: string[] = [root]
    while (queue.length) {
      const cur = queue.shift()!
      for (const n of this.connections.get(cur) ?? []) {
        if (n === scopedRoomIdToRemove) continue
        if (!remaining.includes(n)) continue
        if (reachable.has(n)) continue
        reachable.add(n)
        queue.push(n)
      }
    }
    for (const id of remaining) {
      if (!reachable.has(id)) return { ok: false, reason: 'would-disconnect' }
    }

    // Tear down room state.
    const removedGeometryIds: string[] = []
    for (const geomId of [...instance.geometryIds]) {
      const owningRoom = this.geometryRoomId.get(geomId)
      if (owningRoom !== scopedRoomIdToRemove) continue
      physics.removeGeometry(geomId)
      this.geometryRoomId.delete(geomId)
      this.flattenedGeometry.delete(geomId)
      removedGeometryIds.push(geomId)
      const idx = instance.geometryIds.indexOf(geomId)
      if (idx >= 0) instance.geometryIds.splice(idx, 1)
    }
    this.roomBounds.delete(scopedRoomIdToRemove)
    this.roomViewByScopedId.delete(scopedRoomIdToRemove)
    this.overlappingRoomIds.delete(scopedRoomIdToRemove)
    this.connections.delete(scopedRoomIdToRemove)
    for (const neighbours of this.connections.values()) {
      neighbours.delete(scopedRoomIdToRemove)
    }
    this.removeConnectionRecordsFor(scopedRoomIdToRemove)
    instance.scopedRoomIds = remaining
    instance.rooms = instance.rooms.filter(r => r.scopedId !== scopedRoomIdToRemove)
    // Camera shapes for this instance now contain a stale rect for the
    // removed room. Rebuild from the remaining rooms.
    instance.cameraShapes = rebuildCameraShapesForInstance(instance, this.roomViewByScopedId)
    this.notifyChange()
    return { ok: true }
  }

  // ── Spec serialization ─────────────────────────────────────────────────────

  // Reconstruct a GameMap-ish object from current state for the given map
  // instance. Excludes runtime overlays — the caller (level editor / tools)
  // gets pure topology back.
  saveAsMapSpec(mapInstanceId: string): {
    id: string
    mapInstanceId: string
    origin?: RoomWorldPos
    rooms: RoomSpec[]
    connections: RoomConnection[]
  } | null {
    const instance = this.mapInstances.get(mapInstanceId)
    if (!instance) return null

    // Rebuild RoomSpecs with their current world-space positions baked in as
    // explicit `x` / `y` (so re-loading the spec reproduces the same layout
    // without re-running BFS through cross-instance edges).
    const rooms: RoomSpec[] = []
    for (const view of instance.rooms) {
      const r = view.room
      const live: RoomSpec = {
        ...r,
        x: view.worldPos.x,
        y: view.worldPos.z,
      }
      rooms.push(live)
    }

    // Connections incident to any room in this instance. We pull from the
    // current `connections` map (the runtime state) rather than instance.map
    // so scenarios' setConnectionEnabled mutations are reflected. Cross-
    // instance edges are dropped — saveAsMapSpec is for a single map.
    const seen = new Set<string>()
    const connectionsOut: RoomConnection[] = []
    const scopedSet = new Set(instance.scopedRoomIds)
    for (const a of instance.scopedRoomIds) {
      const neighbours = this.connections.get(a)
      if (!neighbours) continue
      for (const b of neighbours) {
        if (!scopedSet.has(b)) continue  // skip cross-instance edges
        const key = a < b ? `${a}|${b}` : `${b}|${a}`
        if (seen.has(key)) continue
        seen.add(key)
        const original = (instance.map?.connections ?? []).find(c =>
          (scopedRoomId(mapInstanceId, c.roomIdA) === a && scopedRoomId(mapInstanceId, c.roomIdB) === b) ||
          (scopedRoomId(mapInstanceId, c.roomIdA) === b && scopedRoomId(mapInstanceId, c.roomIdB) === a),
        )
        if (original) connectionsOut.push(original)
        // If we can't find the authoring connection (e.g. for a synthetic
        // single-room instance), we omit it — saveAsMapSpec returns the
        // best-effort topology, not the runtime adjacency mutations.
      }
    }

    return {
      id: instance.map?.id ?? mapInstanceId,
      mapInstanceId,
      origin: instance.rooms.length > 0 ? { x: instance.rooms[0].worldPos.x, z: instance.rooms[0].worldPos.z } : undefined,
      rooms,
      connections: connectionsOut,
    }
  }

  // ── Read-only accessors ────────────────────────────────────────────────────

  getMapInstance(mapInstanceId: string): WorldMapInstance | undefined {
    const inst = this.mapInstances.get(mapInstanceId)
    return inst ? { mapInstanceId: inst.mapInstanceId, scopedRoomIds: [...inst.scopedRoomIds] } : undefined
  }

  getRoomsInMapInstance(mapInstanceId: string): string[] {
    const instance = this.mapInstances.get(mapInstanceId)
    return instance ? [...instance.scopedRoomIds] : []
  }

  getMapInstanceIds(): string[] { return [...this.mapInstances.keys()] }

  // Snapshot the current adjacency state as a plain-JSON record. Mirrors the
  // legacy World.getConnectionsSnapshot semantics.
  getConnectionsSnapshot(): Record<string, string[]> {
    const out: Record<string, string[]> = {}
    for (const [a, neigh] of this.connections) out[a] = [...neigh]
    return out
  }

  applyConnectionsSnapshot(snapshot: Record<string, string[]>): void {
    this.connections.clear()
    for (const [a, neigh] of Object.entries(snapshot)) {
      this.connections.set(a, new Set(neigh))
    }
  }

  getAllRooms(): WorldRoomView[] {
    const out: WorldRoomView[] = []
    for (const inst of this.mapInstances.values()) out.push(...inst.rooms)
    return out
  }

  getRoomByScopedId(scopedId: string): WorldRoomView | undefined {
    return this.roomViewByScopedId.get(scopedId)
  }

  // Returns the union of camera rects + transition zones across every
  // attached map instance. Per-instance shapes carry local-room-id
  // annotations (`belongsToRoomLocalId` / `belongsToRoomLocalIds`); we
  // re-key those into scoped ids on the fly so callers can filter by
  // current-room without rebuilding the per-instance caches.
  //
  // When `opts.currentRoomScopedId` is provided, the result is filtered to:
  //   - the camera rect for that one room only, AND
  //   - any transition zone whose connection has that room on either side
  //     (so the camera can extend INTO the bridge toward the neighbour
  //     while the player is still in the current room).
  //
  // When `opts.currentRoomScopedId` is undefined OR points at a room that
  // hasn't been registered (e.g. before the local player is placed; the
  // gameStore seeds `currentRoomId` to `''`), we fall back to the
  // unfiltered union — that keeps the camera from snapping to the world
  // origin during the first frames before the server has assigned the
  // local player to a room.
  getCameraShapes(opts?: { currentRoomScopedId?: string }): CameraConstraintShapes {
    const filterRoom = opts?.currentRoomScopedId
    const useFilter = filterRoom !== undefined && filterRoom !== '' && this.roomViewByScopedId.has(filterRoom)

    const rects: CameraRect[] = []
    const zones: CameraZone[] = []
    for (const inst of this.mapInstances.values()) {
      const mapInstanceId = inst.mapInstanceId
      for (const r of inst.cameraShapes.rects) {
        const scopedOwner = r.belongsToRoomLocalId !== undefined
          ? scopedRoomId(mapInstanceId, r.belongsToRoomLocalId)
          : undefined
        if (useFilter) {
          if (scopedOwner !== filterRoom) continue
        }
        rects.push({
          xMin: r.xMin, xMax: r.xMax, zMin: r.zMin, zMax: r.zMax,
          belongsToRoomLocalId: r.belongsToRoomLocalId,
        })
      }
      for (const z of inst.cameraShapes.zones) {
        const scopedOwners = z.belongsToRoomLocalIds?.map(id => scopedRoomId(mapInstanceId, id)) ?? []
        if (useFilter) {
          if (!scopedOwners.includes(filterRoom)) continue
        }
        zones.push({ corners: z.corners, belongsToRoomLocalIds: z.belongsToRoomLocalIds })
      }
    }
    return { rects, zones }
  }

  getAdjacentRoomIds(scopedRoomId: string): string[] {
    const set = this.connections.get(scopedRoomId)
    return set ? [...set] : []
  }

  getRoomAtPosition(x: number, z: number): string | null {
    for (const inst of this.mapInstances.values()) {
      const sid = inst.artifacts.getRoomAtPosition(x, z)
      if (sid !== null) return sid
    }
    return null
  }

  isRoomOverlapping(scopedRoomId: string): boolean {
    return this.overlappingRoomIds.has(scopedRoomId)
  }

  // World needs this for processMove's per-player room-visibility gating.
  getGeometryRoomId(geomId: string): string | undefined {
    return this.geometryRoomId.get(geomId)
  }

  // World iterates the map instances directly to expose vote regions; this
  // accessor lets it stay decoupled from the internal struct.
  getMapInstanceMaps(): GameMap[] {
    const out: GameMap[] = []
    for (const inst of this.mapInstances.values()) {
      if (inst.map) out.push(inst.map)
    }
    return out
  }

  getRoomBounds(scopedRoomId: string): RoomBounds | undefined {
    return this.roomBounds.get(scopedRoomId)
  }

  // World.resolveCurrentRoom (the fallback path) and isInRoomSet need to walk
  // every room's AABB. Iterating the Map directly lets World stay close to
  // its previous implementation without exposing the inner Map.
  forEachRoomBounds(cb: (scopedId: string, bounds: RoomBounds) => void): void {
    for (const [sid, b] of this.roomBounds) cb(sid, b)
  }

  // ── Connection mutation ────────────────────────────────────────────────────

  setConnectionEnabled(scopedRoomIdA: string, scopedRoomIdB: string, enabled: boolean): void {
    if (enabled) {
      this.addConnectionEdge(scopedRoomIdA, scopedRoomIdB)
    } else {
      this.connections.get(scopedRoomIdA)?.delete(scopedRoomIdB)
      this.connections.get(scopedRoomIdB)?.delete(scopedRoomIdA)
    }
  }

  isConnectionEnabled(scopedRoomIdA: string, scopedRoomIdB: string): boolean {
    return this.connections.get(scopedRoomIdA)?.has(scopedRoomIdB) ?? false
  }

  // Look up the door-side data for the connection between two scoped rooms.
  // Returns `undefined` when the rooms are not connected at all (i.e. there is
  // no door between them). Disabled-but-installed connections still return a
  // record — callers that care should also check `isConnectionEnabled`.
  // Used by `Scene.processMove`'s connection-gap check (Task 5) to gate
  // wall-crossing moves through the door opening.
  getConnectionBetween(scopedRoomIdA: string, scopedRoomIdB: string): ConnectionRecord | undefined {
    return this.connectionRecords.get(canonicalPairKey(scopedRoomIdA, scopedRoomIdB))
  }

  // Returns the door side belonging to `scopedRoomId` from a connection record
  // resolved by `getConnectionBetween`. Convenience accessor so callers don't
  // have to re-check the record's A/B orientation.
  getConnectionSideForRoom(record: ConnectionRecord, scopedRoomId: string): RoomConnectionSide | undefined {
    if (record.scopedRoomIdA === scopedRoomId) return record.sideA
    if (record.scopedRoomIdB === scopedRoomId) return record.sideB
    return undefined
  }

  // ── Change subscription ────────────────────────────────────────────────────

  getMapsVersion(): number { return this.mapsVersion }

  subscribeToMapChanges(cb: () => void): () => void {
    this.changeSubscribers.add(cb)
    return () => { this.changeSubscribers.delete(cb) }
  }

  notifyChange(): void {
    this.mapsVersion++
    for (const cb of this.changeSubscribers) cb()
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private syntheticInstanceCounter = 0

  private nextSyntheticInstanceId(): string {
    this.syntheticInstanceCounter++
    return `__synth_room_${this.syntheticInstanceCounter}`
  }

  private addConnectionEdge(a: string, b: string): void {
    let sA = this.connections.get(a)
    if (!sA) { sA = new Set(); this.connections.set(a, sA) }
    sA.add(b)
    let sB = this.connections.get(b)
    if (!sB) { sB = new Set(); this.connections.set(b, sB) }
    sB.add(a)
  }

  // Store a connection record keyed by canonical pair. `sideForA` describes
  // the door on `scopedRoomIdA`'s wall; `sideForB` likewise. The record is
  // normalized so the canonical-min id is `scopedRoomIdA`.
  private addConnectionRecord(
    scopedRoomIdA: string,
    sideForA: RoomConnectionSide,
    scopedRoomIdB: string,
    sideForB: RoomConnectionSide,
  ): void {
    const [a, b, sa, sb] = scopedRoomIdA <= scopedRoomIdB
      ? [scopedRoomIdA, scopedRoomIdB, sideForA, sideForB]
      : [scopedRoomIdB, scopedRoomIdA, sideForB, sideForA]
    this.connectionRecords.set(canonicalPairKey(a, b), {
      scopedRoomIdA: a,
      scopedRoomIdB: b,
      sideA: sa,
      sideB: sb,
    })
  }

  // Drop every connection record incident on `scopedRoomId`. Called by
  // removeRoom / removeMap as part of the per-room teardown.
  private removeConnectionRecordsFor(scopedRoomId: string): void {
    for (const key of [...this.connectionRecords.keys()]) {
      const rec = this.connectionRecords.get(key)!
      if (rec.scopedRoomIdA === scopedRoomId || rec.scopedRoomIdB === scopedRoomId) {
        this.connectionRecords.delete(key)
      }
    }
  }

  private installMapInstance(
    map: GameMap,
    mapInstanceId: string,
    artifacts: MapInstanceArtifacts,
    physics: PhysicsAdapter,
  ): WorldMapInstance {
    const { scopedRoomIds, roomBounds, geometry, adjacency, roomPositions } = artifacts

    for (const [scopedId, bounds] of roomBounds) {
      this.roomBounds.set(scopedId, bounds)
    }

    for (const [scopedId, neighbours] of adjacency) {
      const existing = this.connections.get(scopedId) ?? new Set<string>()
      for (const n of neighbours) existing.add(n)
      this.connections.set(scopedId, existing)
    }

    // Register per-edge connection records (door wall / length / position) so
    // Task 5's connection-gap movement check can resolve them in O(1).
    for (const conn of map.connections) {
      const a = scopedRoomId(mapInstanceId, conn.roomIdA)
      const b = scopedRoomId(mapInstanceId, conn.roomIdB)
      this.addConnectionRecord(a, conn.room1, b, conn.room2)
    }

    const geometryIds: string[] = []
    for (const g of geometry) {
      physics.addGeometry(g)
      this.geometryRoomId.set(g.id, g.roomId)
      this.flattenedGeometry.set(g.id, g)
      geometryIds.push(g.id)
    }

    const rooms: WorldRoomView[] = []
    for (const room of map.rooms) {
      const scopedId = scopedRoomId(mapInstanceId, room.id)
      const worldPos = roomPositions.get(scopedId)
      if (!worldPos) continue
      const view: WorldRoomView = {
        scopedId,
        mapInstanceId,
        localRoomId: room.id,
        room,
        worldPos,
      }
      rooms.push(view)
      this.roomViewByScopedId.set(scopedId, view)
    }

    // Rebuild the camera shapes from the freshly-positioned rooms. We use
    // a synthetic spec keyed by local room ids because that's the contract
    // buildCameraConstraintShapes expects.
    const localPositionsForCamera = new Map(
      map.rooms.map(r => [r.id, roomPositions.get(scopedRoomId(mapInstanceId, r.id))!]),
    )
    const cameraShapes = buildCameraConstraintShapes(map, localPositionsForCamera)

    // Recompute the union overlap set.
    this.overlappingRoomIds.clear()
    for (const inst of this.mapInstances.values()) {
      for (const sid of inst.scopedRoomIds) {
        if (inst.artifacts.isRoomOverlapping(sid)) this.overlappingRoomIds.add(sid)
      }
    }
    for (const sid of scopedRoomIds) {
      if (artifacts.isRoomOverlapping(sid)) this.overlappingRoomIds.add(sid)
    }

    const internal: RoomManagerMapInstance = {
      mapInstanceId,
      scopedRoomIds: [...scopedRoomIds],
      source: 'map',
      map,
      rooms,
      geometryIds,
      cameraShapes,
      artifacts,
    }
    this.mapInstances.set(mapInstanceId, internal)
    this.notifyChange()
    return { mapInstanceId, scopedRoomIds: [...scopedRoomIds] }
  }

  private installSynthetic(
    syntheticInstanceId: string,
    artifacts: MapInstanceArtifacts,
    room: RoomSpec,
    physics: PhysicsAdapter,
  ): void {
    const scoped = scopedRoomId(syntheticInstanceId, room.id)
    const worldPos = artifacts.roomPositions.get(scoped)!
    this.roomBounds.set(scoped, artifacts.roomBounds.get(scoped)!)
    if (!this.connections.has(scoped)) this.connections.set(scoped, new Set())

    const geometryIds: string[] = []
    for (const g of artifacts.geometry) {
      physics.addGeometry(g)
      this.geometryRoomId.set(g.id, g.roomId)
      this.flattenedGeometry.set(g.id, g)
      geometryIds.push(g.id)
    }

    const view: WorldRoomView = {
      scopedId: scoped,
      mapInstanceId: syntheticInstanceId,
      localRoomId: room.id,
      room,
      worldPos,
    }
    this.roomViewByScopedId.set(scoped, view)

    const cameraShapes = buildCameraConstraintShapes(
      { rooms: [room], connections: [] },
      new Map([[room.id, worldPos]]),
    )

    const internal: RoomManagerMapInstance = {
      mapInstanceId: syntheticInstanceId,
      scopedRoomIds: [scoped],
      source: 'synthetic',
      map: null,
      rooms: [view],
      geometryIds,
      cameraShapes,
      artifacts,
    }
    this.mapInstances.set(syntheticInstanceId, internal)
    // Synthetic single-room instances can't overlap with themselves; the
    // overlap union only tracks within-instance overlaps anyway, so there's
    // nothing to add here. The set stays consistent.
  }
}

// Compute the world-space centre of `unknownRoom` placed adjacent to
// `knownRoom` along the wall pair described by `knownSide` and `unknownSide`.
// Mirrors the inline math in WorldSpec.computeRoomPositions for a single
// edge — we lift it here so addRoom and attachMap can place a single new
// piece without round-tripping through a full WorldSpec BFS for that edge.
function computeNeighbourCenter(
  knownRoom: RoomSpec,
  knownPos: RoomWorldPos,
  knownSide: { wall: Wall; position: number },
  unknownRoom: RoomSpec,
  unknownSide: { wall: Wall; position: number },
): RoomWorldPos {
  let doorX: number, doorZ: number
  if (knownSide.wall === 'north' || knownSide.wall === 'south') {
    doorX = knownPos.x + (knownSide.position - 0.5) * knownRoom.floorWidthX
    doorZ = knownSide.wall === 'north'
      ? knownPos.z - knownRoom.floorDepthY / 2
      : knownPos.z + knownRoom.floorDepthY / 2
  } else {
    doorZ = knownPos.z + (knownSide.position - 0.5) * knownRoom.floorDepthY
    doorX = knownSide.wall === 'east'
      ? knownPos.x + knownRoom.floorWidthX / 2
      : knownPos.x - knownRoom.floorWidthX / 2
  }

  let ux: number, uz: number
  if (unknownSide.wall === 'north' || unknownSide.wall === 'south') {
    ux = doorX - (unknownSide.position - 0.5) * unknownRoom.floorWidthX
    uz = unknownSide.wall === 'south'
      ? doorZ - unknownRoom.floorDepthY / 2
      : doorZ + unknownRoom.floorDepthY / 2
  } else {
    uz = doorZ - (unknownSide.position - 0.5) * unknownRoom.floorDepthY
    ux = unknownSide.wall === 'west'
      ? doorX + unknownRoom.floorWidthX / 2
      : doorX - unknownRoom.floorWidthX / 2
  }
  return { x: ux, z: uz }
}

// Rebuild a single instance's camera shapes from the current view list. Used
// after removeRoom so a pulled room's rect doesn't linger in the union.
function rebuildCameraShapesForInstance(
  instance: RoomManagerMapInstance,
  views: Map<string, WorldRoomView>,
): CameraConstraintShapes {
  const rooms: RoomSpec[] = []
  const localPositions = new Map<string, RoomWorldPos>()
  for (const sid of instance.scopedRoomIds) {
    const v = views.get(sid)
    if (!v) continue
    rooms.push(v.room)
    localPositions.set(v.room.id, v.worldPos)
  }
  return buildCameraConstraintShapes({ rooms, connections: [] }, localPositions)
}

// Canonical pair key for an unordered scoped-room-id pair. Used to key
// `connectionRecords` so the same edge isn't stored twice under (a,b) and
// (b,a) orderings.
function canonicalPairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`
}

// Re-export the connection-side type so callers of addRoom / attachMap don't
// have to dig into WorldSpec for the wall+length+position+transitionRegion
// argument shape.
export type { RoomConnectionSide }
