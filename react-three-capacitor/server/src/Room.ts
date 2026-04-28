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
import { BotRunner, type BotRunnerOptions } from './bot/BotRunner.js'
import type { BotLogEntry } from './bot/BotClient.js'
import type { PlayerRecordingManager } from './PlayerRecordingManager.js'
import type { ScenarioSpec } from './ContentRegistry.js'
import { mergeMaps } from './orchestration/mergeMaps.js'
import {
  computeHubMergeArgs,
  shiftMapToOrigin,
  type ExitMergeArgs,
} from './orchestration/hubAttachment.js'
import { scopedRoomId } from '../../src/game/WorldSpec.js'

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

// Output channel for a seated player. Humans connect over a WebSocket; bots
// spawned via `spawnBotInRoom` run in-process and receive messages as typed
// objects (no JSON round-trip).
type PlayerChannel =
  | { kind: 'ws'; ws: WebSocket }
  | { kind: 'bot'; runner: BotRunner }

interface PlayerState { id: string; channel: PlayerChannel; color: string; index: number; browserUuid: string | null }
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
  // Deprecated; scenarios now spawn bots directly via `spawnBotInRoom`, which
  // drives a `BotRunner` bound to this MR's world and bypasses WebSocket
  // routing. The field is kept so existing callers that still pass it don't
  // break type-checking during the migration; the value is ignored.
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
  // Hard cap on concurrent players (humans + bots). Threaded from the
  // scenario's `maxPlayers` field via `scenarioRoom.ts`. Orchestrations read
  // `getPlayerCount()` vs `maxPlayers` to decide whether to keep seating
  // joins; `isHubSlotOpen()` also enforces this cap.
  maxPlayers: number
  // When true, the room tears itself down as soon as its player count
  // reaches zero (used by solo hallway MRs, which are per-connection).
  // Default false: rooms normally linger while their scenario runs.
  autoDestroyOnEmpty?: boolean
  // Fires when a scenario running in this room invokes `ctx.exitScenario()`.
  // The server wires this to `executeExitTransfer`, which sweeps every
  // seated player into a fresh initial-hallway MR. Only meaningful for
  // scenarios whose spec carries `exitConnection`.
  onExitScenario?: (scenarioId: string) => void
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
  // Running bot drivers keyed by the bot's seated player id. Scenario bots
  // are spawned in-process via `spawnBotInRoom` and live here until the bot's
  // player is removed from the room (elimination, room destroy, etc.). The
  // `botIndex` fixes a stable spawn order so log consumers can number bots.
  private readonly bots: Map<string, { runner: BotRunner; botIndex: number }> = new Map()
  // Accumulated log entries from bots that have already stopped, tagged with
  // the bot's seating-order index. Live-runner logs are still held by the
  // runner itself and merged in on `collectBotLogs`.
  private readonly botLogs: Array<{ botIndex: number; log: BotLogEntry }> = []
  private nextBotIndex = 0
  private readonly spawnPosition: { x: number; z: number }
  readonly maxPlayers: number
  // Every map attached via `addMap()`, in attach order. Kept for flattening
  // per-room geometry to the wire on connect/observer snapshot.
  private readonly attachedMaps: GameMap[] = []
  // Composed map-level room lookup: returns the scoped room id containing
  // (x, z), or null. Accumulated across `addMap()` calls so a scenario can
  // resolve positions regardless of which map instance the rooms live in.
  private getRoomAtPositionFn: (x: number, z: number) => string | null = () => null
  private scheduledCbs: Array<{ targetTick: number; cb: () => void; cancelled: boolean }> = []
  private readonly readyPlayerIds: Set<string> = new Set()

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
  // Map-instance id of the temporarily attached hallway, cleared when the
  // hallway is removed by `releaseHubTransferState`.
  private hubTransferHallwayInstanceId: string | null = null
  private readonly autoDestroyOnEmpty: boolean
  private readonly onExitScenario?: (scenarioId: string) => void

  constructor(opts: MultiplayerRoomOptions) {
    const { roomId, instanceIndex, tickRateHz, onCloseScenario, onRoomDone, spawnPosition, onScenarioTerminate, recordingManager, hubConnection, maxPlayers, autoDestroyOnEmpty, onExitScenario } = opts
    if (!Number.isInteger(maxPlayers) || maxPlayers < 1) {
      throw new Error(`[MultiplayerRoom:${roomId}] maxPlayers must be a positive integer, got ${maxPlayers}`)
    }
    this.roomId = roomId
    this.instanceIndex = instanceIndex
    this.onCloseScenario = onCloseScenario
    this.onRoomDone = onRoomDone
    this.onScenarioTerminate = onScenarioTerminate
    this.recordingManager = recordingManager
    this.spawnPosition = spawnPosition ?? { x: 0, z: 0 }
    this.hubConnection = hubConnection
    this.hubSlotOpen = hubConnection !== undefined
    this.maxPlayers = maxPlayers
    this.autoDestroyOnEmpty = autoDestroyOnEmpty ?? false
    this.onExitScenario = onExitScenario
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
  // + current connections snapshot to every player who has at least one room
  // of that map currently visible. Players whose every room of the map is
  // toggled off do NOT receive the message — they neither know nor need to
  // know the map exists. (The "joining map invisible to existing target
  // players" half of the merge-maps spec is enforced here on the wire.)
  broadcastMapAdd(mapInstanceId: string): void {
    const map = this.attachedMaps.find(m => m.mapInstanceId === mapInstanceId)
    if (!map) return
    const payload = {
      type: 'map_add' as const,
      map: serializeGameMap(map),
      geometry: this.collectWireGeometryForMap(map),
      connections: this.world.getConnectionsSnapshot(),
    }
    for (const pid of this.players.keys()) {
      if (this.world.playerHasMapVisible(pid, mapInstanceId)) {
        this.sendToPlayer(pid, payload)
      }
    }
  }

  // Same per-player visibility gate as `broadcastMapAdd`. Players who never
  // had any room of this map visible never received the corresponding
  // `map_add` either, so they don't need (and can't act on) the removal.
  broadcastMapRemove(mapInstanceId: string): void {
    for (const pid of this.players.keys()) {
      if (this.world.playerHasMapVisible(pid, mapInstanceId)) {
        this.sendToPlayer(pid, { type: 'map_remove', mapInstanceId })
      }
    }
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
      // Attach the bot to THIS scenario specifically (not `attachPlayerToDefault`)
      // — scenarios that have already called `ctx.closeScenario()` no longer
      // have a default-open designation, but they may still want to spawn
      // bots into their own script (this is exactly the scenario1–4
      // close-then-fill pattern).
      spawnBot: (spec) => { this.spawnBotInRoom(spec, { attachToScenarioId: config.id }) },
      getBotIds: () => [...this.bots.keys()],
      overrideBotMovement: (pid, jx, jz) => { this.bots.get(pid)?.runner.overrideMovement(jx, jz) },
      onExitScenario: this.onExitScenario ? (scenarioId) => this.onExitScenario!(scenarioId) : undefined,
      removeMap: (mapInstanceId) => {
        this.removeMap(mapInstanceId)
        this.broadcastMapRemove(mapInstanceId)
      },
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

  // Current seated player count (humans + bots + NPC-driven players — every
  // entry in `this.players`). Used by orchestrations to decide whether a
  // room can accept another join without exceeding `maxPlayers`.
  getPlayerCount(): number {
    return this.players.size
  }

  // The id of the scenario currently advertised as "open to new joins" in
  // this room, or null if no scenario is accepting joins right now. A room
  // can run multiple scenarios simultaneously but exposes at most one as
  // the join target — this is exactly the ScenarioManager's default-open
  // designation, cleared by `ctx.closeScenario()` or scenario deletion.
  getOpenScenarioId(): string | null {
    return this.scenarios.getDefaultOpen()?.id ?? null
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

  handleAbilityUse(playerId: string, abilityId: string): void {
    if (!this.players.has(playerId)) return
    this.scenarios.forPlayer(playerId)?.handleAbilityUse(playerId, abilityId)
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
    this.seatPlayerCore(playerId, { kind: 'ws', ws }, browserUuid, routingKey, spawn)
    return playerId
  }

  // Shared seating used by both WS-backed and in-process (bot) players. The
  // caller mints `playerId` so hook closures (e.g. BotRunner's sendMove /
  // sendReady) can reference the final id before the welcome message —
  // emitted inline below — dispatches back into the channel. The `channel`
  // selects how outgoing messages leave this MR; everything else (color,
  // spawn, world_reset / welcome / player_joined fanout) is identical.
  private seatPlayerCore(playerId: string, channel: PlayerChannel, browserUuid: string | null, routingKey: string, spawn: { x: number; z: number }): void {
    const color = this.pickColor()
    const index = this.nextPlayerIndex++
    this.players.set(playerId, { id: playerId, channel, color, index, browserUuid })
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

    this.sendToPlayer(playerId, this.buildWorldResetForPlayer(playerId))

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
  }

  // Whether this room can accept an incoming hub transfer. Used by the hub
  // routing code to find a target MR for a waiting solo-hallway player. The
  // capacity check accounts for the transfer itself (seating happens inside
  // `acceptHubTransfer`), so a room already at `maxPlayers` is not a valid
  // target even if its internal `hubSlotOpen` flag is still true.
  isHubSlotOpen(): boolean {
    return this.hubSlotOpen
      && this.hubConnection !== undefined
      && !this.closed
      && this.players.size < this.maxPlayers
  }

  hasHubConnection(): boolean {
    return this.hubConnection !== undefined
  }

  // Transfer an arriving hub player into this room. The WebSocket is the
  // same connection the player held on their private solo-hallway MR — the
  // caller is expected to have called `releasePlayer` on the solo MR to
  // detach without closing.
  //
  // Flow (no ceremony, no ack waiters):
  //   1. Validate the hubConnection's dock geometry against the joining
  //      hallway's hallway-room dimensions.
  //   2. `mergeMaps` — attach the shifted hallway to this world and hide
  //      every joining-map room from each existing player (server-side, so
  //      the wire-filter on world_reset never ships hallway data to them).
  //   3. Seat the joining player + attach to scenario.
  //   4. Drop both dock walls per-player (visibility + collision) so the
  //      new joiner walks through. The walls go back up for the joiner via
  //      the scenario's `onPlayerEnterRoom(targetMain)` handler when the
  //      player crosses into the main room.
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
    const targetMap = this.attachedMaps[0]
    if (!targetMap) throw new Error(`[MultiplayerRoom:${this.roomId}] acceptHubTransfer with no attached target map`)

    const merge = computeHubMergeArgs(initialMap, targetMap, this.hubConnection)
    const shiftedHallway = shiftMapToOrigin(initialMap, merge.hallwayOrigin)
    const merged = mergeMaps({
      target: this,
      joiningMap: shiftedHallway,
      joiningRoomId: merge.joiningRoomId,
      joiningWall: 'north',
      joiningWallPosition: 0.5,
      targetRoomScopedId: scopedRoomId(targetMap.mapInstanceId, this.hubConnection.mainRoomId),
      targetWall: 'south',
      targetWallPosition: merge.targetWallPosition,
      dockLength: merge.dockLength,
    })

    const spawnWorld = {
      x: merge.hallwayOrigin.x + initialSpawnLocal.x,
      z: merge.hallwayOrigin.z + initialSpawnLocal.z,
    }
    const playerId = this.seatPlayer(ws, browserUuid, routingKey, spawnWorld)
    this.scenarios.attachPlayerToDefault(playerId)

    this.hubSlotOpen = false
    this.hubTransferPlayerId = playerId
    this.hubTransferHallwayInstanceId = merged.attachedMapInstanceId

    this.dropDockWallsForPlayer(playerId, merge.joiningWallId, merged.joiningRoomScopedId, this.hubConnection.dockGeometryId, merged.targetRoomScopedId)

    console.log(`[MultiplayerRoom:${this.roomId}] hub transfer in: player=${playerId}`)
    return playerId
  }

  // Drop the joining-side and target-side dock walls for `playerId` only.
  // Lockstep visibility + collision: scenes/worlds carry both flips so the
  // wall both renders away AND becomes passable for the joiner. Other
  // players are unaffected (they may not even have the joining map in their
  // local world). The script's `onPlayerEnterRoom` handler re-raises the
  // walls per-player when the joiner crosses into the main scenario room.
  private dropDockWallsForPlayer(
    playerId: string,
    joiningWallGeomId: string,
    joiningRoomScopedId: string,
    targetWallGeomId: string,
    targetRoomScopedId: string,
  ): void {
    const scene = this.world.getScene()
    const physics = this.world.getPhysics()
    scene.toggleEntityVisibilityOff(joiningRoomScopedId, joiningWallGeomId, playerId)
    scene.toggleEntityVisibilityOff(targetRoomScopedId, targetWallGeomId, playerId)
    physics.toggleEntityCollisionsOff(joiningWallGeomId, playerId)
    physics.toggleEntityCollisionsOff(targetWallGeomId, playerId)
    this.sendToPlayer(playerId, {
      type: 'geometry_state',
      perPlayer: true,
      updates: [
        { id: joiningWallGeomId, visible: false },
        { id: targetWallGeomId, visible: false },
      ],
    })
  }

  // Detach the hub-transferred player's hallway after they have crossed
  // into the main scenario rooms. Removes the map (which broadcasts a
  // `map_remove` only to players with the hallway visible — i.e. the
  // joiner) and reopens the slot. The per-player dock-wall toggles set up
  // in `acceptHubTransfer` were already restored by the script's
  // `onPlayerEnterRoom` handler before this fires; whatever entity-
  // visibility / collision overrides remain are pruned by Scene/Physics
  // when the geometry ids disappear via `removeMap`'s teardown.
  private releaseHubTransferState(): void {
    const hallwayId = this.hubTransferHallwayInstanceId
    if (hallwayId) {
      this.removeMap(hallwayId)
      this.broadcastMapRemove(hallwayId)
    }
    this.hubTransferHallwayInstanceId = null
    this.hubTransferPlayerId = null
    if (this.hubConnection !== undefined && !this.closed) this.hubSlotOpen = true
  }

  // Bulk snapshot of every seated player's ws / browserUuid / current world
  // position. Used by the exit-transfer orchestrator to collect connections
  // before releasing them. The returned list is a detached array — mutating
  // the room afterwards doesn't touch it.
  getPlayerHandles(): Array<{
    playerId: string
    ws: WebSocket
    browserUuid: string | null
    x: number
    z: number
  }> {
    // Bots have no WebSocket and cannot be transferred across MRs; exclude
    // them so exit-transfer callers don't try to hand off a non-existent
    // connection. The bots are torn down implicitly when their source MR
    // closes.
    const out: Array<{ playerId: string; ws: WebSocket; browserUuid: string | null; x: number; z: number }> = []
    for (const [pid, p] of this.players) {
      if (p.channel.kind !== 'ws') continue
      const wp = this.world.getPlayer(pid)
      if (!wp) continue
      out.push({ playerId: pid, ws: p.channel.ws, browserUuid: p.browserUuid, x: wp.x, z: wp.z })
    }
    return out
  }

  // Seat a player transferred in from an exit-source MR. The first call on a
  // freshly-built target MR performs the cross-instance merge (attaches the
  // source map via `mergeMaps`); every subsequent call only seats + drops
  // the per-player dock walls. There is no ack ceremony — the welcome /
  // world_reset and the per-player toggles all ship in the same outbound
  // bundle so the client sees a consistent state on rebuild.
  //
  // The dock geometry comes from `mergeArgs` (computed in
  // `executeExitTransfer` from the source scenario's `exitConnection`).
  acceptExitTransfer(
    ws: WebSocket,
    browserUuid: string | null,
    routingKey: string,
    sourceMap: GameMap,
    worldPos: { x: number; z: number },
    mergeArgs: ExitMergeArgs,
  ): string {
    if (this.closed) {
      throw new Error(`[MultiplayerRoom:${this.roomId}] acceptExitTransfer called on a closed room`)
    }

    // Lazy first-time merge: the target MR was built with only the hallway
    // attached. The first transferring player triggers the source-map
    // attach + cross-instance edge wiring; later transfers short-circuit.
    const alreadyAttached = this.attachedMaps.some(m => m.mapInstanceId === sourceMap.mapInstanceId)
    if (!alreadyAttached) {
      mergeMaps({
        target: this,
        joiningMap: sourceMap,
        joiningRoomId: mergeArgs.sourceRoomId,
        joiningWall: 'north',
        joiningWallPosition: mergeArgs.sourceWallPosition,
        targetRoomScopedId: mergeArgs.targetRoomScopedId,
        targetWall: 'south',
        targetWallPosition: 0.5,
        dockLength: mergeArgs.dockLength,
      })
    }

    const playerId = this.seatPlayer(ws, browserUuid, routingKey, worldPos)
    this.scenarios.attachPlayerToDefault(playerId)

    const sourceRoomScopedId = scopedRoomId(sourceMap.mapInstanceId, mergeArgs.sourceRoomId)
    this.dropDockWallsForPlayer(
      playerId,
      mergeArgs.sourceWallId,
      sourceRoomScopedId,
      mergeArgs.targetWallId,
      mergeArgs.targetRoomScopedId,
    )

    console.log(`[MultiplayerRoom:${this.roomId}] exit transfer in: player=${playerId} at (${worldPos.x.toFixed(3)},${worldPos.z.toFixed(3)})`)
    return playerId
  }

  // Terminal cleanup after an exit transfer: all players have already been
  // released; fire the registry lifecycle callbacks (onCloseScenario then
  // onRoomDone) exactly once and stop the tick loop. Idempotent.
  closeAndDestroy(): void {
    if (!this.closed) {
      this.closed = true
      this.onCloseScenario?.()
    }
    this.scenarios.destroyAll()
    if (!this.roomDoneFired) {
      this.roomDoneFired = true
      this.onRoomDone?.()
    }
    if (this.tickTimer) {
      clearTimeout(this.tickTimer)
      this.tickTimer = null
    }
  }

  // Detach a player from this room without broadcasting a `player_left` and
  // without closing the WebSocket. Used by the hub flow to move a player
  // off their private solo-hallway MR before seating them on the target MR.
  // The returned id is the one the room had assigned; the caller typically
  // discards it (the target MR allocates a new id).
  releasePlayer(playerId: string): void {
    const player = this.players.get(playerId)
    if (!player) return
    // Bots have no WebSocket to hand off. If a caller tries to release a
    // bot, treat it as a full removal so the runner is torn down cleanly.
    if (player.channel.kind === 'bot') {
      this.removePlayer(playerId, false)
      return
    }
    this.scenarios.detachPlayer(playerId)
    this.players.delete(playerId)
    this.world.removePlayer(playerId)
    this.pendingMoves.delete(playerId)
    this.readyPlayerIds.delete(playerId)
    // No `player_left` broadcast — the WS is being handed off to another
    // MR, not closed. Do NOT finalize the recording here: the target MR's
    // `connectPlayerShared` will call `onPlayerConnected` with the new id
    // and the recording manager rebinds the in-flight buffer onto it.
    // Finalizing here would save the solo-hallway segment as the whole
    // recording and `resolveIndex` would then reject the target MR's
    // fresh attempt because the persisted recording already exists.
  }

  // Tear down this room deterministically. Used for short-lived solo
  // hallway MRs after their player has been transferred out. Stops the
  // tick loop and destroys scenario state. Safe to call when there are no
  // players.
  destroy(): void {
    this.closed = true
    // Stop every bot runner so they don't keep ticking after the room's
    // tick loop has been torn down. Snapshot logs so `collectBotLogs` still
    // returns their output after destroy.
    for (const { runner, botIndex } of this.bots.values()) {
      runner.stop()
      for (const entry of runner.logs) this.botLogs.push({ botIndex, log: entry })
    }
    this.bots.clear()
    this.scenarios.destroyAll()
    if (this.tickTimer) {
      clearTimeout(this.tickTimer)
      this.tickTimer = null
    }
  }

  // Spawn a bot driven in-process by this MR's own world — no WebSocket, no
  // routing, no BotManager. Called from `ctx.spawnBot` inside a scenario
  // script (see `buildScenario`). The bot is seated at the room's default
  // `spawnPosition` and immediately starts its tick loop; removing the bot
  // player from the room also stops and drops its runner. Returns the
  // allocated player id.
  //
  // When `attachToScenarioId` is set, the bot is attached to that specific
  // scenario (needed when the caller has already cleared the default-open
  // designation via `closeScenario`); otherwise it attaches to whatever
  // scenario is currently the default-open one.
  spawnBotInRoom(
    spec: BotSpec,
    options?: BotRunnerOptions & { attachToScenarioId?: string },
  ): string {
    const botIndex = this.nextBotIndex++
    const label = `${this.roomId}#${botIndex}`
    // Mint the player id first so the runner's hooks (sendMove, sendReady)
    // can reference it by closure before seatPlayerCore dispatches the
    // welcome message back into the runner.
    const playerId = crypto.randomUUID()
    const runner = new BotRunner(label, spec, {
      sendMove: (tick, inputs) => this.handleMove(playerId, tick, inputs),
      sendReady: () => this.handlePlayerReady(playerId),
      // Bots don't currently react to game_event choices, but wire the hook
      // symmetrically so a future BotSpec.onChoice path doesn't need a
      // separate plumbing change.
      sendChoice: () => { /* no-op: no game_event flow wired to bots today */ },
      sendAbilityUse: (abilityId) => this.handleAbilityUse(playerId, abilityId),
    }, options)
    // Start the runner before seating so the welcome message dispatched from
    // `seatPlayerCore` → `sendToPlayer` → `runner.deliverMessage` isn't
    // dropped by the runner's `!running` guard.
    runner.start()
    this.seatPlayerCore(playerId, { kind: 'bot', runner }, null, this.roomId, this.spawnPosition)
    this.bots.set(playerId, { runner, botIndex })
    // When the runner stops, snapshot its accumulated logs into the room's
    // collection so `collectBotLogs` keeps working after the bot has torn
    // itself down (e.g. elimination, room destroy).
    runner.onStopped(() => {
      for (const entry of runner.logs) this.botLogs.push({ botIndex, log: entry })
    })
    if (options?.attachToScenarioId) {
      this.scenarios.attachPlayerTo(playerId, options.attachToScenarioId)
    } else {
      this.scenarios.attachPlayerToDefault(playerId)
    }
    return playerId
  }

  // Readable snapshot of every bot log this room has ever collected. Used by
  // `ScenarioRunRegistry.finalize` to fold scenario-bot output into the run
  // artifact (where `BotManager.collectLogsForKey` used to live).
  collectBotLogs(): Array<{ botIndex: number; log: BotLogEntry }> {
    // Live runners still hold their logs; merge them with already-drained
    // entries for a stopped-aware snapshot.
    const out = [...this.botLogs]
    for (const { runner, botIndex } of this.bots.values()) {
      for (const entry of runner.logs) out.push({ botIndex, log: entry })
    }
    return out.sort((a, b) => a.log.time - b.log.time)
  }

  getLivingPlayerIds(): string[] {
    return [...this.players.keys()]
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
    // Stop any BotRunner bound to this player so its tick loop doesn't keep
    // ticking against a world that no longer has the player.
    const bot = this.bots.get(playerId)
    if (bot) {
      this.bots.delete(playerId)
      bot.runner.notifyRemoved()
    }
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

  // Build a `world_reset` payload filtered to the maps `playerId` has at
  // least one visible room in. This is the wire half of the merge-maps spec:
  // a player who has every room of a map toggled off doesn't see the map's
  // topology / geometry / connections for that map at all. Connections
  // incident to filtered-out maps are dropped from the snapshot too — they
  // can't refer to rooms the player doesn't know about.
  private buildWorldResetForPlayer(playerId: string): ServerMessage {
    const visibleMaps = this.attachedMaps.filter(m =>
      this.world.playerHasMapVisible(playerId, m.mapInstanceId),
    )
    const visibleScopedRoomIds = new Set<string>()
    for (const m of visibleMaps) {
      for (const r of m.rooms) visibleScopedRoomIds.add(`${m.mapInstanceId}_${r.id}`)
    }
    const geometry: WireGeometry[] = []
    for (const m of visibleMaps) {
      for (const g of this.collectWireGeometryForMap(m)) geometry.push(g)
    }
    const fullConnections = this.world.getConnectionsSnapshot()
    const connections: Record<string, string[]> = {}
    for (const [a, neighbours] of Object.entries(fullConnections)) {
      if (!visibleScopedRoomIds.has(a)) continue
      const filtered = neighbours.filter(n => visibleScopedRoomIds.has(n))
      connections[a] = filtered
    }
    return {
      type: 'world_reset',
      maps: visibleMaps.map(serializeGameMap),
      geometry,
      connections,
    }
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
    let data: string | null = null
    for (const p of this.players.values()) {
      if (p.channel.kind === 'bot') {
        p.channel.runner.deliverMessage(msg)
      } else {
        if (data === null) data = JSON.stringify(msg)
        if (p.channel.ws.readyState === WebSocket.OPEN) p.channel.ws.send(data)
      }
    }
  }

  private sendToPlayer(playerId: string, msg: ServerMessage): void {
    this.recordingManager?.onMessageToPlayer(playerId, msg, this.serverTick)
    const p = this.players.get(playerId)
    const obs = this.observers.get(playerId)
    if (!p && !obs?.size) return
    if (p?.channel.kind === 'bot') {
      p.channel.runner.deliverMessage(msg)
    }
    if (p?.channel.kind === 'ws' || obs?.size) {
      const data = JSON.stringify(msg)
      if (p?.channel.kind === 'ws' && p.channel.ws.readyState === WebSocket.OPEN) p.channel.ws.send(data)
      if (obs?.size) {
        for (const ws of obs) {
          if (ws.readyState === WebSocket.OPEN) ws.send(data)
        }
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

    // Observers see the same world_reset the observed player would see —
    // filtered to the maps that player has at least one visible room in.
    // Spectating a hub-scenario player who can't see the hallway means the
    // observer also can't see the hallway, which is the desired behavior
    // (otherwise the spectator's UI would render rooms the player can't).
    msgs.push(this.buildWorldResetForPlayer(playerId))

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
