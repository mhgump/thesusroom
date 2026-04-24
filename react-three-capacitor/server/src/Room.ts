import WebSocket from 'ws'
import type { ServerMessage, MoveInput } from './types.js'
import { World, TICK_RATE_HZ } from './World.js'
import type { TouchedEvent, DamageEvent, WorldDump, WorldEvent } from './World.js'
import type { ScenarioDump } from './Scenario.js'
import type { WireGeometry } from './GameSpec.js'
import { NpcManager } from './npc/NpcManager.js'
import { ScenarioManager } from './ScenarioManager.js'
import { Scenario } from './Scenario.js'
import type { ScenarioConfig, ScenarioDeps } from './Scenario.js'
import type { GameMap } from '../../src/game/GameMap.js'
import { serializeGameMap } from '../../src/game/GameMap.js'
import type { BotSpec } from './bot/BotTypes.js'
import type { PlayerRecordingManager } from './PlayerRecordingManager.js'
import type { ScenarioSpec } from './ContentRegistry.js'
import { computeHubAttachment, shiftMapToOrigin, type HubAttachment } from './orchestration/hubAttachment.js'

const NPC_COLOR = '#888888'
const SIM_MS_PER_TICK = 1000 / TICK_RATE_HZ

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if      (h < 60)  { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else              { r = c; b = x }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

function rgbDist(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db)
}

interface PlayerState { id: string; ws: WebSocket; color: string; index: number; browserUuid: string | null }
interface PendingMove { clientTick: number; inputs: MoveInput[] }

// A point-in-time snapshot of a MultiplayerRoom, combining its World's dump
// with a per-scenario dump keyed by scenario id. Round-trips through
// JSON.stringify. Restore is caller-orchestrated: the caller constructs a
// fresh Room, addMap's every map from the dump (supplying the GameMap
// instances), calls `world.restoreState(dump.world, mapsByInstance)`, then
// rebuilds each scenario and calls `scenario.restoreState(dump.scenarios[id])`
// before any `startScenario` call.
export interface RoomDump {
  world: WorldDump
  scenarios: Record<string, ScenarioDump>
}

export interface MultiplayerRoomOptions {
  roomId: string
  instanceIndex: number
  tickRateHz?: number
  // Fires once when the last default-open scenario in this room closes. The
  // router uses this to remove the room from its open list for this routing
  // key. Further connect attempts will create a new room.
  onCloseScenario?: () => void
  // Fires once when the closed room has lost its last player. The router uses
  // this to free the room's slot in the per-key all-rooms index.
  onRoomDone?: () => void
  // Called when a scenario-script invokes `ctx.spawnBot`. The callback is
  // scoped to the room's routing key so scenario-spawned bots reconnect
  // through the same orchestration.
  spawnBotFn?: (spec: BotSpec) => void
  // World-space position used to seed every human player on connect. When
  // omitted, players spawn at (0, 0). Orchestrations set this from the
  // scenario's `spawn` field.
  spawnPosition?: { x: number; z: number }
  // Fires when a scenario in this room invokes `ctx.terminate()`. Receives
  // the terminating scenario id. Production leaves this unset; the
  // run-scenario CLI wires it to resolve its done promise.
  onScenarioTerminate?: (scenarioId: string) => void
  // Captures outgoing messages per human player for first-minute replay.
  // Optional: tests and harnesses that don't care about recording can omit.
  recordingManager?: PlayerRecordingManager
  // When set, the room advertises a hub slot: one incoming player can be
  // transferred in from a solo hallway via `acceptHubTransfer`. The
  // orchestration populates this from the scenario's `hubConnection` field.
  hubConnection?: NonNullable<ScenarioSpec['hubConnection']>
  // When true, the room tears itself down as soon as its player count
  // reaches zero (used by solo hallway MRs, which are per-connection).
  // Default false: rooms normally linger while their scenario runs.
  autoDestroyOnEmpty?: boolean
}

// A MultiplayerRoom owns one World, one ScenarioManager, the tick loop, and
// the player I/O channel. Scenarios are added by the orchestration layer; at
// runtime each attached player is bound to exactly one scenario (the default
// open one on connect, unless `attachPlayerTo` is used).
export class MultiplayerRoom {
  readonly roomId: string
  readonly instanceIndex: number
  readonly world: World
  readonly scenarios: ScenarioManager = new ScenarioManager()

  private players: Map<string, PlayerState> = new Map()
  private nextPlayerIndex = 0
  private readonly observers: Map<string, Set<WebSocket>> = new Map()
  private pendingMoves: Map<string, PendingMove[]> = new Map()
  private serverTick = 0
  private tickTimer: ReturnType<typeof setTimeout> | null = null
  private nextTickAt = 0
  private readonly tickIntervalMs: number
  private readonly tickRateHz: number
  private readonly npcManager: NpcManager
  private closed = false
  private roomDoneFired = false
  private readonly onCloseScenario?: () => void
  private readonly onRoomDone?: () => void
  private readonly onScenarioTerminate?: (scenarioId: string) => void
  private readonly recordingManager?: PlayerRecordingManager
  private readonly spawnBotFn: (spec: BotSpec) => void
  private readonly spawnPosition: { x: number; z: number }
  // Every map attached via `addMap()`, in attach order. Kept for flattening
  // per-room geometry to the wire on connect/observer snapshot.
  private readonly attachedMaps: GameMap[] = []
  // Composed map-level room lookup: returns the scoped room id containing
  // (x, z), or null. Accumulated across `addMap()` calls so a scenario can
  // resolve positions regardless of which map instance the rooms live in.
  private getRoomAtPositionFn: (x: number, z: number) => string | null = () => null
  private scheduledCbs: Array<{ targetTick: number; cb: () => void; cancelled: boolean }> = []
  private readonly readyPlayerIds: Set<string> = new Set()
  // Per-player waiters fired on the next `world_reset_ack`. The hub transfer
  // flow enqueues its reveal step here so walls drop only after the client
  // has rebuilt its local world from the reset snapshot.
  private readonly worldResetAckWaiters: Map<string, Array<() => void>> = new Map()

  // Hub attach declaration from the scenario, or undefined if this room is
  // not hub-capable. `hubSlotOpen` starts true iff hubConnection is present,
  // and flips to false while a transferred player is still inside the
  // hallway segment. Reopens when the player crosses into the main scenario
  // rooms (handled in the tick loop).
  private readonly hubConnection?: NonNullable<ScenarioSpec['hubConnection']>
  private hubSlotOpen: boolean
  // Player id currently occupying the hub slot (waiting in the hallway after
  // transfer). Null outside transfer windows.
  private hubTransferPlayerId: string | null = null
  // Attachment placement cache for the in-flight transfer. Used by the
  // ack-gated reveal and the slot-release path.
  private hubTransferAttachment: HubAttachment | null = null
  // Map-instance id of the temporarily attached hallway, cleared when the
  // hallway is released.
  private hubTransferHallwayInstanceId: string | null = null
  // Timer that reopens the slot if the ack never arrives.
  private hubTransferTimeoutCancel: (() => void) | null = null
  private readonly autoDestroyOnEmpty: boolean

  constructor(opts: MultiplayerRoomOptions) {
    const { roomId, instanceIndex, tickRateHz, onCloseScenario, onRoomDone, spawnBotFn, spawnPosition, onScenarioTerminate, recordingManager, hubConnection, autoDestroyOnEmpty } = opts
    this.roomId = roomId
    this.instanceIndex = instanceIndex
    this.onCloseScenario = onCloseScenario
    this.onRoomDone = onRoomDone
    this.onScenarioTerminate = onScenarioTerminate
    this.recordingManager = recordingManager
    this.spawnBotFn = spawnBotFn ?? (() => {})
    this.spawnPosition = spawnPosition ?? { x: 0, z: 0 }
    this.hubConnection = hubConnection
    this.hubSlotOpen = hubConnection !== undefined
    this.autoDestroyOnEmpty = autoDestroyOnEmpty ?? false
    this.tickRateHz = tickRateHz ?? TICK_RATE_HZ
    this.world = new World([], {
      scheduleSimMs: (ms, cb) => this.scheduleSimMs(ms, cb),
      getServerTick: () => this.serverTick,
      getSimMsPerTick: () => SIM_MS_PER_TICK,
    })
    this.npcManager = new NpcManager(
      this.world,
      (npcId, x, z, events) => {
        this.broadcast({ type: 'player_update', playerId: npcId, x, z, events, serverTick: this.serverTick })
      },
      (ms, cb) => this.scheduleSimMs(ms, cb),
    )
    this.tickIntervalMs = 1000 / this.tickRateHz
    this.nextTickAt = performance.now() + this.tickIntervalMs
    const loop = () => {
      this.runTick()
      if (this.closed && this.players.size === 0) return
      this.nextTickAt += this.tickIntervalMs
      const delay = Math.max(0, this.nextTickAt - performance.now())
      this.tickTimer = setTimeout(loop, delay)
    }
    this.tickTimer = setTimeout(loop, this.tickIntervalMs)
  }

  // Register a map with this room's world (builds the scoped room ids,
  // default adjacency, and Rapier colliders) and spawn the map's NPCs.
  // Returns the scoped room ids contributed by the map. Does NOT broadcast a
  // wire message; callers decide whether the addition is per-player (hub
  // transfer) or room-wide (mid-session scenario addition) and use
  // `sendMapAddToPlayer` / `broadcastMapAdd` accordingly.
  addMap(map: GameMap): string[] {
    const instance = this.world.addMap(map)
    this.attachedMaps.push(map)
    this.npcManager.spawnAll(map.npcs)
    const prev = this.getRoomAtPositionFn
    const mapLookup = map.getRoomAtPosition
    this.getRoomAtPositionFn = (x, z) => mapLookup(x, z) ?? prev(x, z)
    return [...instance.scopedRoomIds]
  }

  // Remove a previously-added map. Tears down all Rapier colliders, room
  // bounds, and adjacency edges the map introduced. Does NOT broadcast;
  // callers use `sendMapRemoveToPlayer` / `broadcastMapRemove` explicitly.
  removeMap(mapInstanceId: string): void {
    const map = this.attachedMaps.find(m => m.mapInstanceId === mapInstanceId)
    if (!map) return
    this.world.removeMap(mapInstanceId)
    this.attachedMaps.splice(this.attachedMaps.indexOf(map), 1)
    // Recompute the fallback-chain for getRoomAtPositionFn from scratch — the
    // removed map's lookup needs to drop out of the chain, and maintaining an
    // opaque closure chain makes that awkward. Rebuild deterministically.
    this.getRoomAtPositionFn = () => null
    for (const m of this.attachedMaps) {
      const prev = this.getRoomAtPositionFn
      const lookup = m.getRoomAtPosition
      this.getRoomAtPositionFn = (x, z) => lookup(x, z) ?? prev(x, z)
    }
  }

  // Send a `map_add` carrying a specific map's topology + flattened geometry
  // + current connections snapshot to a single player. Used by the hub
  // transfer so the arriving player's client picks up the hallway without
  // leaking it to other players in the target MR.
  sendMapAddToPlayer(playerId: string, mapInstanceId: string): void {
    const map = this.attachedMaps.find(m => m.mapInstanceId === mapInstanceId)
    if (!map) return
    this.sendToPlayer(playerId, {
      type: 'map_add',
      map: serializeGameMap(map),
      geometry: this.collectWireGeometryForMap(map),
      connections: this.world.getConnectionsSnapshot(),
    })
  }

  sendMapRemoveToPlayer(playerId: string, mapInstanceId: string): void {
    this.sendToPlayer(playerId, { type: 'map_remove', mapInstanceId })
  }

  broadcastMapAdd(mapInstanceId: string): void {
    const map = this.attachedMaps.find(m => m.mapInstanceId === mapInstanceId)
    if (!map) return
    this.broadcast({
      type: 'map_add',
      map: serializeGameMap(map),
      geometry: this.collectWireGeometryForMap(map),
      connections: this.world.getConnectionsSnapshot(),
    })
  }

  broadcastMapRemove(mapInstanceId: string): void {
    this.broadcast({ type: 'map_remove', mapInstanceId })
  }

  // Construct a Scenario that will attach to this room, without adding it.
  buildScenario(attachedRoomIds: string[], config: ScenarioConfig, overrides?: Partial<ScenarioDeps>): Scenario {
    const deps: ScenarioDeps = {
      world: this.world,
      sendToPlayer: (pid, msg) => this.sendToPlayer(pid, msg),
      broadcast: (msg) => this.broadcast(msg),
      removePlayer: (pid, eliminated) => this.removePlayer(pid, eliminated),
      onClose: () => this.handleScenarioClose(config.id),
      onTerminate: () => this.onScenarioTerminate?.(config.id),
      spawnBot: (spec) => this.spawnBotFn(spec),
      scheduleSimMs: (ms, cb) => this.scheduleSimMs(ms, cb),
      getServerTick: () => this.serverTick,
      getSimMsPerTick: () => SIM_MS_PER_TICK,
      getRoomAtPosition: (x, z) => this.getRoomAtPositionFn(x, z),
      ...overrides,
    }
    return new Scenario(attachedRoomIds, config, deps)
  }

  startScenario(scenarioId: string): void {
    this.scenarios.start(scenarioId)
  }

  deleteScenario(scenarioId: string): void {
    this.scenarios.delete(scenarioId)
  }

  isOpen(): boolean {
    return !this.closed
  }

  // Produce a JSON-serializable snapshot of this room's World plus the
  // per-scenario script state + pending registrations. Contains no function
  // references or class instances. See `RoomDump` for the restore protocol.
  dumpState(): RoomDump {
    const scenarios: Record<string, ScenarioDump> = {}
    for (const scenario of this.scenarios.all()) {
      scenarios[scenario.id] = scenario.dumpState()
    }
    return { world: this.world.dumpState(), scenarios }
  }

  handleMove(playerId: string, clientTick: number, inputs: MoveInput[]): void {
    if (!this.players.has(playerId)) return
    let arr = this.pendingMoves.get(playerId)
    if (!arr) { arr = []; this.pendingMoves.set(playerId, arr) }
    arr.push({ clientTick, inputs })
  }

  handlePlayerReady(playerId: string): void {
    if (!this.players.has(playerId)) return
    if (!this.readyPlayerIds.has(playerId)) {
      this.readyPlayerIds.add(playerId)
    }
    this.scenarios.forPlayer(playerId)?.onPlayerReady(playerId)
  }

  // Fires when the client confirms it has rebuilt its local World from a
  // `world_reset`. Per-player callbacks registered via
  // `onceWorldResetAcked` are invoked, then cleared. Used by the hub flow to
  // gate the reveal (drop walls + enable the cross-instance adjacency edge)
  // behind the client being ready to see the target scenario.
  handleWorldResetAck(playerId: string): void {
    const cbs = this.worldResetAckWaiters.get(playerId)
    if (!cbs) return
    this.worldResetAckWaiters.delete(playerId)
    for (const cb of cbs) cb()
  }

  // Register a one-shot callback for the next `world_reset_ack` from this
  // player. Returns a cancel function. Multiple waiters for the same player
  // are queued and all fire on the next ack.
  onceWorldResetAcked(playerId: string, cb: () => void): () => void {
    let list = this.worldResetAckWaiters.get(playerId)
    if (!list) { list = []; this.worldResetAckWaiters.set(playerId, list) }
    list.push(cb)
    return () => {
      const arr = this.worldResetAckWaiters.get(playerId)
      if (!arr) return
      const i = arr.indexOf(cb)
      if (i >= 0) arr.splice(i, 1)
    }
  }

  private runTick(): void {
    if (this.closed && this.players.size === 0) {
      this.scenarios.destroyAll()
      return
    }
    if (this.autoDestroyOnEmpty && !this.closed && this.players.size === 0 && this.serverTick > 0) {
      // Per-connection MR emptied out — tear down. The `serverTick > 0`
      // guard lets the first tick run even before the initial player has
      // been seated, in case construction schedules any work before connect.
      this.destroy()
      return
    }

    this.serverTick++

    for (const [playerId, moves] of this.pendingMoves) {
      moves.sort((a, b) => a.clientTick - b.clientTick)
      const flat: MoveInput[] = []
      for (const m of moves) flat.push(...m.inputs)
      this.world.queueMove(playerId, flat)
    }

    const { perPlayer: eventsPerPlayer, global: globalEvents } = this.world.processTick()

    // Dispatch world-level events to every scenario (they drive script
    // handlers) and broadcast the wire-facing events.
    for (const event of globalEvents) this.dispatchGlobalEvent(event)

    for (const [playerId, moves] of this.pendingMoves) {
      const playerEvents = eventsPerPlayer.get(playerId) ?? []
      const npcEvents = this.npcManager.onPlayerMove(playerEvents)
      const allEvents = npcEvents.length > 0 ? [...playerEvents, ...npcEvents] : playerEvents
      const wp = this.world.getPlayer(playerId)!

      const lastIdx = moves.length - 1
      for (let i = 0; i < moves.length; i++) {
        this.sendToPlayer(playerId, {
          type: 'move_ack',
          clientTick: moves[i].clientTick,
          x: wp.x,
          z: wp.z,
          events: i === lastIdx ? allEvents : [],
          serverTick: this.serverTick,
        })
      }

      const touchEvents = allEvents.filter((e): e is TouchedEvent => e.type === 'touched')
      const nonTouchEvents = touchEvents.length > 0 ? allEvents.filter(e => e.type !== 'touched') : allEvents
      for (const [id] of this.players) {
        if (id === playerId) continue
        const playerTouchEvents = touchEvents.filter(e => e.playerIdA === id || e.playerIdB === id)
        const events = playerTouchEvents.length > 0 ? [...nonTouchEvents, ...playerTouchEvents] : nonTouchEvents
        this.sendToPlayer(id, {
          type: 'player_update',
          playerId,
          x: wp.x,
          z: wp.z,
          events,
          serverTick: this.serverTick,
        })
      }

      for (const event of allEvents) {
        if (event.type === 'damage' && (event as DamageEvent).newHp === 0 && this.players.has((event as DamageEvent).targetId)) {
          this.removePlayer((event as DamageEvent).targetId, true)
        }
      }

      if (this.players.has(playerId)) {
        this.scenarios.onPlayerMoved(playerId)
      }
    }

    // Hub slot release: if the transferred player has moved out of the
    // hallway's scoped room into one of the target scenario's rooms, tear
    // down the hallway and reopen the slot.
    this.maybeReleaseHubTransfer()

    this.pendingMoves.clear()

    this.drainScheduled()

    // Cooldown callbacks run inside drainScheduled and may enqueue global
    // events (e.g. a button transitioning back to `idle`). Drain those now
    // so the broadcast fires this tick rather than next.
    const lateGlobal = this.world.drainPendingGlobalEvents()
    for (const event of lateGlobal) this.dispatchGlobalEvent(event)
  }

  // Per-tick check: if the hub-transferred player's current room has
  // transitioned out of the hallway and into a scenario-owned room, tear
  // down the temporarily-attached hallway and reopen this room's hub slot
  // so the next `/` arrival can be seated here.
  private maybeReleaseHubTransfer(): void {
    const pid = this.hubTransferPlayerId
    const hallwayId = this.hubTransferHallwayInstanceId
    if (!pid || !hallwayId) return
    if (!this.players.has(pid)) {
      // Player disappeared (disconnect/elimination) mid-transfer; still
      // want to clear the hallway so a new hub player can try again.
      this.releaseHubTransferState()
      return
    }
    const player = this.world.getPlayer(pid)
    if (!player) return
    const scopedId = this.getRoomAtPositionFn(player.x, player.z)
    if (!scopedId) return
    // Any room outside the hallway's scope counts as "entered scenario" —
    // hub transfer only attaches one hallway at a time, so there are no
    // other non-target rooms the player could be in.
    if (!scopedId.startsWith(`${hallwayId}_`)) {
      console.log(`[MultiplayerRoom:${this.roomId}] hub transferred player entered ${scopedId} — releasing hallway`)
      this.releaseHubTransferState()
    }
  }

  // Fan a World global event out to (a) every scenario for handler dispatch
  // and (b) the wire, if the event has a wire representation. Keeps
  // broadcast logic in one place so Scenario stays script-only.
  private dispatchGlobalEvent(event: WorldEvent): void {
    for (const scenario of this.scenarios.all()) scenario.onWorldEvent(event)
    switch (event.type) {
      case 'button_state_change':
        this.broadcast({ type: 'button_state', id: event.buttonId, state: event.state, occupancy: event.occupancy })
        return
      case 'button_config_change':
        this.broadcast({ type: 'button_config', id: event.buttonId, changes: event.changes })
        return
      case 'vote_region_change': {
        const activeRegions = this.world.getActiveVoteRegions()
        const assignments: Record<string, string[]> = {}
        for (const rid of activeRegions) assignments[rid] = []
        for (const [pid, rid] of Object.entries(event.assignments)) {
          if (rid && rid in assignments) assignments[rid].push(pid)
        }
        this.broadcast({ type: 'vote_assignment_change', assignments })
        return
      }
      case 'room_visibility_change': {
        const updates = event.updates
        if (event.scope === 'all') {
          this.broadcast({ type: 'room_visibility_state', updates })
        } else {
          for (const pid of event.scope.playerIds) {
            this.sendToPlayer(pid, { type: 'room_visibility_state', updates, perPlayer: true })
          }
        }
        return
      }
      default:
        return
    }
  }

  scheduleSimMs(simDurationMs: number, cb: () => void): () => void {
    const delta = Math.max(1, Math.ceil(simDurationMs / SIM_MS_PER_TICK))
    const entry = { targetTick: this.serverTick + delta, cb, cancelled: false }
    this.scheduledCbs.push(entry)
    return () => { entry.cancelled = true }
  }

  private drainScheduled(): void {
    if (this.scheduledCbs.length === 0) return
    const remaining: typeof this.scheduledCbs = []
    for (const e of this.scheduledCbs) {
      if (e.cancelled) continue
      if (e.targetTick <= this.serverTick) {
        try { e.cb() } catch (err) { console.error('[MultiplayerRoom] scheduled cb threw:', err) }
      } else {
        remaining.push(e)
      }
    }
    this.scheduledCbs = remaining
  }

  connectPlayer(ws: WebSocket, browserUuid: string | null = null, routingKey: string = this.roomId): string {
    const playerId = this.seatPlayer(ws, browserUuid, routingKey, this.spawnPosition)
    this.scenarios.attachPlayerToDefault(playerId)
    console.log(`[MultiplayerRoom:${this.roomId}] +player ${playerId} (total:${this.players.size})`)
    return playerId
  }

  // Shared plumbing between normal `connectPlayer` and `acceptHubTransfer`:
  // allocate an id, add to the world at a given spawn, register recording,
  // send welcome + world_reset, and exchange player_joined fan-outs (plus
  // NPC notifications). Does NOT attach the player to a scenario; the caller
  // chooses whether to call `scenarios.attachPlayerToDefault(playerId)` so
  // hub transfers can skip the attach until after reveal if needed.
  private seatPlayer(ws: WebSocket, browserUuid: string | null, routingKey: string, spawn: { x: number; z: number }): string {
    const playerId = crypto.randomUUID()
    const color = this.pickColor()
    const index = this.nextPlayerIndex++
    this.players.set(playerId, { id: playerId, ws, color, index, browserUuid })
    this.world.addPlayer(playerId, spawn.x, spawn.z)

    if (browserUuid && this.recordingManager) {
      this.recordingManager.onPlayerConnected({ browserUuid, inGamePlayerId: playerId, routingKey })
    }

    const wp = this.world.getPlayer(playerId)!
    this.sendToPlayer(playerId, {
      type: 'welcome',
      playerId,
      color,
      x: wp.x,
      z: wp.z,
      hp: wp.hp,
      serverTick: this.serverTick,
      tickRateHz: this.tickRateHz,
    })

    this.sendToPlayer(playerId, {
      type: 'world_reset',
      maps: this.attachedMaps.map(serializeGameMap),
      geometry: this.collectWireGeometry(),
      connections: this.world.getConnectionsSnapshot(),
    })

    for (const [id, p] of this.players) {
      if (id === playerId) continue
      const ep = this.world.getPlayer(id)!
      this.sendToPlayer(playerId, {
        type: 'player_joined',
        playerId: id,
        color: p.color,
        x: ep.x,
        z: ep.z,
        animState: ep.animState,
        hp: ep.hp,
        serverTick: this.serverTick,
      })
      this.sendToPlayer(id, {
        type: 'player_joined',
        playerId,
        color,
        x: wp.x,
        z: wp.z,
        animState: wp.animState,
        hp: wp.hp,
        serverTick: this.serverTick,
      })
    }

    for (const { id, spec } of this.npcManager.getNpcEntries()) {
      const np = this.world.getPlayer(id)!
      this.sendToPlayer(playerId, {
        type: 'player_joined',
        playerId: id,
        color: NPC_COLOR,
        x: np.x,
        z: np.z,
        animState: np.animState,
        hp: np.hp,
        isNpc: true,
        hasHealth: spec.ux.has_health,
        serverTick: this.serverTick,
      })
    }

    return playerId
  }

  // Whether this room can accept an incoming hub transfer. Used by the hub
  // routing code to find a target MR for a waiting solo-hallway player.
  isHubSlotOpen(): boolean {
    return this.hubSlotOpen && this.hubConnection !== undefined && !this.closed
  }

  hasHubConnection(): boolean {
    return this.hubConnection !== undefined
  }

  // Transfer an arriving hub player into this room. The WebSocket is the
  // same connection the player held on their private solo-hallway MR — the
  // caller is expected to have called `releasePlayer` on the solo MR to
  // detach without closing. Adds the initial hallway at the computed
  // attachment origin, seats the player at the hallway's spawn (translated
  // into this room's world frame), sends world_reset, and arms the reveal
  // to fire on `world_reset_ack`. Closes the hub slot until the player
  // crosses into the scenario's main rooms.
  acceptHubTransfer(
    ws: WebSocket,
    browserUuid: string | null,
    routingKey: string,
    initialMap: GameMap,
    initialSpawnLocal: { x: number; z: number },
  ): string {
    if (!this.hubConnection) {
      throw new Error(`[MultiplayerRoom:${this.roomId}] acceptHubTransfer called on a non-hub-capable room`)
    }
    if (!this.hubSlotOpen) {
      throw new Error(`[MultiplayerRoom:${this.roomId}] acceptHubTransfer called while hub slot is closed`)
    }
    // Need a reference scenario spec to feed computeHubAttachment. We only
    // need its hubConnection field — the attachment math doesn't touch the
    // script, timeout, etc. Construct a minimal stand-in.
    const scenarioStand: ScenarioSpec = {
      id: this.roomId,
      script: { initialState: () => ({}) } as unknown as ScenarioSpec['script'],
      timeoutMs: 0,
      hubConnection: this.hubConnection,
    }
    const targetMap = this.attachedMaps[0]
    if (!targetMap) throw new Error(`[MultiplayerRoom:${this.roomId}] acceptHubTransfer with no attached target map`)
    const attachment = computeHubAttachment(initialMap, targetMap, scenarioStand)

    const shiftedHallway = shiftMapToOrigin(initialMap, attachment.hallwayOrigin)
    this.addMap(shiftedHallway)

    const spawnWorld = {
      x: attachment.hallwayOrigin.x + initialSpawnLocal.x,
      z: attachment.hallwayOrigin.z + initialSpawnLocal.z,
    }
    const playerId = this.seatPlayer(ws, browserUuid, routingKey, spawnWorld)
    this.scenarios.attachPlayerToDefault(playerId)

    this.hubSlotOpen = false
    this.hubTransferPlayerId = playerId
    this.hubTransferAttachment = attachment
    this.hubTransferHallwayInstanceId = shiftedHallway.mapInstanceId

    // Arm the reveal, gated on the client confirming it rebuilt its local
    // World from the world_reset snapshot. Also arm a timeout in case the
    // ack never arrives — we don't want the slot stuck closed on a broken
    // client.
    const cancelWaiter = this.onceWorldResetAcked(playerId, () => {
      this.hubTransferTimeoutCancel?.()
      this.hubTransferTimeoutCancel = null
      this.revealHubForPlayer(playerId)
    })
    this.hubTransferTimeoutCancel = this.scheduleSimMs(5000, () => {
      cancelWaiter()
      this.hubTransferTimeoutCancel = null
      console.warn(`[MultiplayerRoom:${this.roomId}] hub transfer ack timeout for player ${playerId} — releasing slot`)
      // Ack never came. Best-effort recover: disconnect the player, tear
      // down the hallway, reopen the slot for someone else.
      this.releaseHubTransferState()
      if (this.players.has(playerId)) this.removePlayer(playerId)
    })

    console.log(`[MultiplayerRoom:${this.roomId}] hub transfer in: player=${playerId}`)
    return playerId
  }

  // Drop the walls and enable the cross-instance adjacency for the
  // transferred player's client. Sends to that player only — other MR
  // occupants don't have the hallway in their local world, so broadcasting
  // would spray state updates for geometry they can't render.
  private revealHubForPlayer(playerId: string): void {
    const attachment = this.hubTransferAttachment
    if (!attachment) return
    this.world.toggleGeometryOff(attachment.initialWallIdToDrop)
    this.world.toggleGeometryOff(attachment.targetWallIdToDrop)
    this.world.setConnectionEnabled(attachment.crossInstanceEdge.a, attachment.crossInstanceEdge.b, true)
    this.sendToPlayer(playerId, {
      type: 'geometry_state',
      updates: [
        { id: attachment.initialWallIdToDrop, visible: false },
        { id: attachment.targetWallIdToDrop, visible: false },
      ],
    })
    this.sendToPlayer(playerId, {
      type: 'connections_state',
      connections: this.world.getConnectionsSnapshot(),
    })
  }

  // Detach the hub-transferred player's hallway: remove the map, clear the
  // cross-instance edge, restore the target's south wall (so other players
  // arriving later still see room1 as enclosed), reopen the slot.
  private releaseHubTransferState(): void {
    const attachment = this.hubTransferAttachment
    const hallwayId = this.hubTransferHallwayInstanceId
    const transferredPid = this.hubTransferPlayerId
    if (attachment && hallwayId) {
      // Tell the transferred player to drop the hallway from their local
      // world. Target wall is restored (turned solid again) for both the
      // world and the player's view so the next hub transfer starts clean.
      this.world.toggleGeometryOn(attachment.targetWallIdToDrop)
      this.world.setConnectionEnabled(attachment.crossInstanceEdge.a, attachment.crossInstanceEdge.b, false)
      if (transferredPid && this.players.has(transferredPid)) {
        this.sendToPlayer(transferredPid, {
          type: 'geometry_state',
          updates: [{ id: attachment.targetWallIdToDrop, visible: true }],
        })
        this.sendMapRemoveToPlayer(transferredPid, hallwayId)
        this.sendToPlayer(transferredPid, {
          type: 'connections_state',
          connections: this.world.getConnectionsSnapshot(),
        })
      }
      this.removeMap(hallwayId)
    }
    this.hubTransferAttachment = null
    this.hubTransferHallwayInstanceId = null
    this.hubTransferPlayerId = null
    this.hubTransferTimeoutCancel?.()
    this.hubTransferTimeoutCancel = null
    if (this.hubConnection !== undefined && !this.closed) this.hubSlotOpen = true
  }

  // Detach a player from this room without broadcasting a `player_left` and
  // without closing the WebSocket. Used by the hub flow to move a player
  // off their private solo-hallway MR before seating them on the target MR.
  // The returned id is the one the room had assigned; the caller typically
  // discards it (the target MR allocates a new id).
  releasePlayer(playerId: string): void {
    const player = this.players.get(playerId)
    if (!player) return
    this.scenarios.detachPlayer(playerId)
    this.players.delete(playerId)
    this.world.removePlayer(playerId)
    this.pendingMoves.delete(playerId)
    this.readyPlayerIds.delete(playerId)
    this.worldResetAckWaiters.delete(playerId)
    // No `player_left` broadcast — the WS is being handed off to another
    // MR, not closed. The recording manager should also stop tracking this
    // player on this MR; downstream calls on the target MR will re-register
    // under the new id.
    this.recordingManager?.onPlayerDisconnected(playerId)
  }

  // Tear down this room deterministically. Used for short-lived solo
  // hallway MRs after their player has been transferred out. Stops the
  // tick loop and destroys scenario state. Safe to call when there are no
  // players.
  destroy(): void {
    this.closed = true
    this.scenarios.destroyAll()
    if (this.tickTimer) {
      clearTimeout(this.tickTimer)
      this.tickTimer = null
    }
  }

  removePlayer(playerId: string, eliminated = false): void {
    const obs = this.observers.get(playerId)
    if (obs?.size) {
      const notice = JSON.stringify({ type: 'observer_player_left', eliminated })
      for (const ws of obs) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(notice)
          ws.close(4010, 'Observed player left')
        }
      }
      this.observers.delete(playerId)
    }
    this.scenarios.detachPlayer(playerId)
    this.sendToPlayer(playerId, { type: 'player_left', playerId })
    this.players.delete(playerId)
    this.world.removePlayer(playerId)
    this.pendingMoves.delete(playerId)
    this.readyPlayerIds.delete(playerId)
    this.worldResetAckWaiters.delete(playerId)
    this.broadcast({ type: 'player_left', playerId })
    // Finalize the player's recording now (if any) — captures partial
    // sessions shorter than the configured duration. The manager's own
    // guards make this a no-op for bots, observers, and players whose
    // recordings already finished.
    this.recordingManager?.onPlayerDisconnected(playerId)
    console.log(`[MultiplayerRoom:${this.roomId}] -player ${playerId} (total:${this.players.size})`)
    this.maybeTriggerRoomDone()
  }

  private handleScenarioClose(scenarioId: string): void {
    this.scenarios.closeDefaultOpen(scenarioId)
    if (this.scenarios.hasDefaultOpen()) return
    if (this.closed) return
    this.closed = true
    this.onCloseScenario?.()
    this.maybeTriggerRoomDone()
  }

  private maybeTriggerRoomDone(): void {
    if (!this.closed || this.players.size > 0 || this.roomDoneFired) return
    this.roomDoneFired = true
    this.scenarios.destroyAll()
    this.onRoomDone?.()
  }

  // Flattens every attached map's per-room geometry to global coords with the
  // owning scoped room id. The client uses the room id to gate rendering by
  // room visibility.
  private collectWireGeometry(): WireGeometry[] {
    const out: WireGeometry[] = []
    for (const map of this.attachedMaps) {
      for (const g of this.collectWireGeometryForMap(map)) out.push(g)
    }
    return out
  }

  private collectWireGeometryForMap(map: GameMap): WireGeometry[] {
    const out: WireGeometry[] = []
    for (const room of map.rooms) {
      const scopedId = `${map.mapInstanceId}_${room.id}`
      const pos = map.roomPositions.get(scopedId)
      if (!pos) continue
      for (const g of room.geometry ?? []) {
        out.push({
          id: g.id,
          roomId: scopedId,
          cx: pos.x + g.cx,
          cy: g.cy,
          cz: pos.z + g.cz,
          width: g.width,
          height: g.height,
          depth: g.depth,
          color: g.color,
          imageUrl: g.imageUrl,
        })
      }
    }
    return out
  }

  private pickColor(): string {
    const usedRgbs = [...this.players.values()].map(p => hexToRgb(p.color))
    const MIN_S = 0.65, MAX_S = 1.0
    const MIN_L = 0.38, MAX_L = 0.60
    let bestHex = ''
    let bestMinDist = -1
    for (let i = 0; i < 300; i++) {
      const h = Math.random() * 360
      const s = MIN_S + Math.random() * (MAX_S - MIN_S)
      const l = MIN_L + Math.random() * (MAX_L - MIN_L)
      const rgb = hslToRgb(h, s, l)
      if (usedRgbs.length === 0) return rgbToHex(rgb)
      const minDist = Math.min(...usedRgbs.map(u => rgbDist(rgb, u)))
      if (minDist > bestMinDist) { bestMinDist = minDist; bestHex = rgbToHex(rgb) }
    }
    return bestHex
  }

  private broadcast(msg: ServerMessage): void {
    if (this.recordingManager) {
      for (const pid of this.players.keys()) this.recordingManager.onMessageToPlayer(pid, msg, this.serverTick)
    }
    const data = JSON.stringify(msg)
    for (const p of this.players.values()) {
      if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data)
    }
  }

  private sendToPlayer(playerId: string, msg: ServerMessage): void {
    this.recordingManager?.onMessageToPlayer(playerId, msg, this.serverTick)
    const p = this.players.get(playerId)
    const obs = this.observers.get(playerId)
    if (!p && !obs?.size) return
    const data = JSON.stringify(msg)
    if (p?.ws.readyState === WebSocket.OPEN) p.ws.send(data)
    if (obs?.size) {
      for (const ws of obs) {
        if (ws.readyState === WebSocket.OPEN) ws.send(data)
      }
    }
  }

  getPlayerIdByIndex(j: number): string | null {
    for (const [id, state] of this.players) {
      if (state.index === j) return id
    }
    return null
  }

  getObserverSnapshot(playerId: string): ServerMessage[] {
    const msgs: ServerMessage[] = []
    const p = this.players.get(playerId)
    const wp = this.world.getPlayer(playerId)
    if (!p || !wp) return msgs

    msgs.push({
      type: 'welcome',
      playerId: p.id,
      color: p.color,
      x: wp.x,
      z: wp.z,
      hp: wp.hp,
      serverTick: this.serverTick,
      tickRateHz: this.tickRateHz,
    })

    msgs.push({
      type: 'world_reset',
      maps: this.attachedMaps.map(serializeGameMap),
      geometry: this.collectWireGeometry(),
      connections: this.world.getConnectionsSnapshot(),
    })

    for (const [id, other] of this.players) {
      if (id === playerId) continue
      const ep = this.world.getPlayer(id)
      if (!ep) continue
      msgs.push({
        type: 'player_joined',
        playerId: id,
        color: other.color,
        x: ep.x,
        z: ep.z,
        animState: ep.animState,
        hp: ep.hp,
        serverTick: this.serverTick,
      })
    }

    for (const { id, spec } of this.npcManager.getNpcEntries()) {
      const np = this.world.getPlayer(id)
      if (!np) continue
      msgs.push({
        type: 'player_joined',
        playerId: id,
        color: NPC_COLOR,
        x: np.x,
        z: np.z,
        animState: np.animState,
        hp: np.hp,
        isNpc: true,
        hasHealth: spec.ux.has_health,
        serverTick: this.serverTick,
      })
    }

    const scenario = this.scenarios.forPlayer(playerId)
    if (scenario) {
      const { geometryUpdates, roomVisibilityUpdates, buttonData, voteAssignments } =
        scenario.getPlayerSnapshotData(playerId)
      if (geometryUpdates) msgs.push({ type: 'geometry_state', updates: geometryUpdates })
      if (roomVisibilityUpdates) msgs.push({ type: 'room_visibility_state', updates: roomVisibilityUpdates })
      if (buttonData.length > 0) msgs.push({ type: 'button_init', buttons: buttonData })
      if (voteAssignments) msgs.push({ type: 'vote_assignment_change', assignments: voteAssignments })
    }

    return msgs
  }

  registerObserver(playerId: string, ws: WebSocket): void {
    if (!this.observers.has(playerId)) this.observers.set(playerId, new Set())
    this.observers.get(playerId)!.add(ws)
  }

  unregisterObserver(playerId: string, ws: WebSocket): void {
    this.observers.get(playerId)?.delete(ws)
  }
}
