import WebSocket from 'ws'
import type { ServerMessage, MoveInput } from './types.js'
import { World, TICK_RATE_HZ } from './World.js'
import type { WalkableArea, PhysicsSpec, TouchedEvent, DamageEvent } from './World.js'
import { NpcManager } from './npc/NpcManager.js'
import { ScenarioManager } from './ScenarioManager.js'
import { Scenario } from './Scenario.js'
import type { ScenarioConfig, ScenarioDeps } from './Scenario.js'
import type { GameMap } from '../../src/game/GameMap.js'
import type { BotSpec } from './bot/BotTypes.js'

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

interface PlayerState { id: string; ws: WebSocket; color: string; index: number }
interface PendingMove { clientTick: number; inputs: MoveInput[] }

export interface MultiplayerRoomOptions {
  roomId: string
  instanceIndex: number
  walkable: WalkableArea
  physics?: PhysicsSpec
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
  // All moves received from a client since the last server tick. Appended to
  // unconditionally (never dropped, never displaced); drained in runTick().
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
  private readonly spawnBotFn: (spec: BotSpec) => void
  // Composed map-level room lookup: returns the scoped room id containing
  // (x, z), or null. Accumulated across `addMap()` calls so a scenario can
  // resolve positions regardless of which map instance the rooms live in.
  private getRoomAtPositionFn: (x: number, z: number) => string | null = () => null
  private scheduledCbs: Array<{ targetTick: number; cb: () => void; cancelled: boolean }> = []
  // Insertion-ordered room-level ready set. Used for bookkeeping and
  // observability; per-scenario ready replay uses each scenario's own set.
  private readonly readyPlayerIds: Set<string> = new Set()

  constructor(opts: MultiplayerRoomOptions) {
    const { roomId, instanceIndex, walkable, physics, tickRateHz, onCloseScenario, onRoomDone, spawnBotFn } = opts
    this.roomId = roomId
    this.instanceIndex = instanceIndex
    this.onCloseScenario = onCloseScenario
    this.onRoomDone = onRoomDone
    this.spawnBotFn = spawnBotFn ?? (() => {})
    this.tickRateHz = tickRateHz ?? TICK_RATE_HZ
    this.world = physics ? World.withPhysics(walkable, physics) : new World(walkable)
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

  // Register a map with this room's world (builds the scoped room ids and
  // default adjacency) and spawn the map's NPCs. Returns the scoped room ids
  // contributed by the map, for use when attaching scenarios.
  addMap(map: GameMap): string[] {
    const instance = this.world.addMap(map)
    this.npcManager.spawnAll(map.npcs)
    const prev = this.getRoomAtPositionFn
    const mapLookup = map.getRoomAtPosition
    this.getRoomAtPositionFn = (x, z) => mapLookup(x, z) ?? prev(x, z)
    return [...instance.scopedRoomIds]
  }

  // Construct a Scenario that will attach to this room, without adding it.
  // The orchestration can then call `scenarios.add(scenario, { default: true })`
  // and optionally `startScenario(id)` to begin.
  buildScenario(attachedRoomIds: string[], config: ScenarioConfig, overrides?: Partial<ScenarioDeps>): Scenario {
    const deps: ScenarioDeps = {
      world: this.world,
      sendToPlayer: (pid, msg) => this.sendToPlayer(pid, msg),
      broadcast: (msg) => this.broadcast(msg),
      removePlayer: (pid, eliminated) => this.removePlayer(pid, eliminated),
      onClose: () => this.handleScenarioClose(config.id),
      spawnBot: (spec) => this.spawnBotFn(spec),
      scheduleSimMs: (ms, cb) => this.scheduleSimMs(ms, cb),
      getServerTick: () => this.serverTick,
      onWalkableUpdate: (area) => { this.world.setWalkable(area); this.world.snapAllPlayers() },
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

  // True while the room still accepts new connections. Transitions to false
  // when the (last) default-open scenario invokes `ctx.closeScenario()`.
  isOpen(): boolean {
    return !this.closed
  }

  handleMove(playerId: string, clientTick: number, inputs: MoveInput[]): void {
    if (!this.players.has(playerId)) return
    // The server never drops client moves. Everything received between the last
    // runTick and the next is buffered and applied on the next tick, sorted by
    // clientTick so that the server processes them in the client's intended order.
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

  private runTick(): void {
    if (this.closed && this.players.size === 0) {
      this.scenarios.destroyAll()
      return
    }

    this.serverTick++

    // Sort each player's pending moves by clientTick, flatten inputs in order,
    // then enqueue onto the world. `world.processTick()` iterates per player
    // (see src/game/World.ts), which gives us the "process each client one at a
    // time, in the tick order the client marked" semantics this design requires.
    for (const [playerId, moves] of this.pendingMoves) {
      moves.sort((a, b) => a.clientTick - b.clientTick)
      const flat: MoveInput[] = []
      for (const m of moves) flat.push(...m.inputs)
      this.world.queueMove(playerId, flat)
    }

    const eventsPerPlayer = this.world.processTick()

    for (const [playerId, moves] of this.pendingMoves) {
      const playerEvents = eventsPerPlayer.get(playerId) ?? []
      const npcEvents = this.npcManager.onPlayerMove(playerEvents)
      const allEvents = npcEvents.length > 0 ? [...playerEvents, ...npcEvents] : playerEvents
      const wp = this.world.getPlayer(playerId)!

      // One move_ack per received client move. All acks for this player share
      // the same final (x, z) — the world position after server tick X.
      // Events attach only to the final ack so the client applies them once.
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

      // One player_update per moving player per server tick. Touch events are
      // routed only to participants; other events go to everyone else.
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

    this.pendingMoves.clear()

    this.drainScheduled()
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

  // Accept a new WebSocket connection: allocate a playerId, register on the
  // world, send welcome + initial state, and auto-attach to the default open
  // scenario (if any). This is the orchestration/router entry point.
  connectPlayer(ws: WebSocket): string {
    const playerId = crypto.randomUUID()
    const color = this.pickColor()
    const index = this.nextPlayerIndex++
    this.players.set(playerId, { id: playerId, ws, color, index })
    this.world.addPlayer(playerId)

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

    // Send map geometry definitions (union across all attached scenarios). In
    // the one-scenario-per-room default there's exactly one.
    const geometry = this.collectGeometrySpecs()
    if (geometry.length > 0) {
      this.sendToPlayer(playerId, { type: 'map_init', geometry })
    }

    // Inform the new player of existing human players, and vice-versa.
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

    // Inform the new player of all NPC entities.
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

    // Attach to the default-open scenario. Its onPlayerAttach sends geometry,
    // room-visibility, and button-init state for the new player.
    this.scenarios.attachPlayerToDefault(playerId)

    console.log(`[MultiplayerRoom:${this.roomId}] +player ${playerId} color:${color} (total:${this.players.size})`)
    return playerId
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
    this.broadcast({ type: 'player_left', playerId })
    console.log(`[MultiplayerRoom:${this.roomId}] -player ${playerId} (total:${this.players.size})`)
    this.maybeTriggerRoomDone()
  }

  // Invoked via a scenario's ctx.closeScenario() binding. Removes the scenario
  // from the default-open slot and, if no default-open remains, closes the
  // whole room so the router stops routing new players to it.
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

  private collectGeometrySpecs() {
    const out: import('./GameSpec.js').FloorGeometrySpec[] = []
    const seen = new Set<string>()
    for (const scenario of this.scenarios.all()) {
      for (const g of scenario.getGeometrySpecs()) {
        if (seen.has(g.id)) continue
        seen.add(g.id)
        out.push(g)
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
    const data = JSON.stringify(msg)
    for (const p of this.players.values()) {
      if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data)
    }
  }

  private sendToPlayer(playerId: string, msg: ServerMessage): void {
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

  // Generates the ordered sequence of messages an observer needs to
  // reconstruct the current game state from player `playerId`'s perspective.
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

    const geometry = this.collectGeometrySpecs()
    if (geometry.length > 0) {
      msgs.push({ type: 'map_init', geometry })
    }

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
