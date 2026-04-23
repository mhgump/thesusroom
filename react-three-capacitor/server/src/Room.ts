import WebSocket from 'ws'
import type { ServerMessage, MoveInput } from './types.js'
import { World, TICK_RATE_HZ } from './World.js'
import type { WalkableArea, PhysicsSpec, TouchedEvent } from './World.js'
import { NpcManager } from './npc/NpcManager.js'
import type { NpcSpec } from './npc/NpcSpec.js'
import { GameScriptManager } from './GameScriptManager.js'
import type { GameSpec, FloorGeometrySpec, InstructionEventSpec } from './GameSpec.js'
import type { GameScript, ActiveVoteRegionChangeEvent } from './GameScript.js'
import type { BotSpec } from './bot/BotTypes.js'

const TICK_INTERVAL_MS = 1000 / TICK_RATE_HZ

const NPC_COLOR = '#888888'

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

export class Room {
  protected readonly roomId: string
  readonly instanceIndex: number
  protected players: Map<string, PlayerState> = new Map()
  protected world: World

  private nextPlayerIndex = 0
  private readonly observers: Map<string, Set<WebSocket>> = new Map()
  // All moves received from a client since the last server tick. Appended to
  // unconditionally (never dropped, never displaced); drained in runTick().
  private pendingMoves: Map<string, PendingMove[]> = new Map()
  private serverTick = 0
  private tickInterval: ReturnType<typeof setInterval>
  private npcManager: NpcManager
  private gameScriptManager: GameScriptManager | null = null
  private readonly geometrySpecs: FloorGeometrySpec[]
  private readonly voteRegionChangeCallbacks: Array<(event: ActiveVoteRegionChangeEvent) => void> = []
  private closed = false
  private roomDoneFired = false
  private readonly onRoomDone?: () => void

  constructor(roomId: string, instanceIndex: number, walkable: WalkableArea, npcs: NpcSpec[] = [], gameSpec?: GameSpec, initialVisibility: Record<string, boolean> = {}, initialRoomVisibility: Record<string, boolean> = {}, gameScript?: GameScript, onCloseScenario?: () => void, onRoomDone?: () => void, walkableVariants: Array<{ triggerIds: string[]; walkable: WalkableArea }> = [], getRoomAtPosition?: (x: number, z: number) => string | null, spawnBotFn?: (spec: BotSpec) => void, physics?: PhysicsSpec, toggleVariants: Array<{ triggerIds: string[]; toggleIds: string[] }> = []) {
    this.instanceIndex = instanceIndex
    this.roomId = roomId
    this.onRoomDone = onRoomDone
    this.world = physics ? World.withPhysics(walkable, physics) : new World(walkable)
    this.geometrySpecs = gameSpec?.geometry ?? []
    this.npcManager = new NpcManager(this.world, (npcId, x, z, events) => {
      this.broadcast({ type: 'player_update', playerId: npcId, x, z, events, serverTick: this.serverTick })
    })
    this.npcManager.spawnAll(npcs)
    if (gameSpec) {
      const wrappedOnClose = () => {
        this.closed = true
        onCloseScenario?.()
        this.maybeTriggerRoomDone()
      }
      this.gameScriptManager = new GameScriptManager(
        this.world,
        gameScript ?? null,
        gameSpec.voteRegions,
        gameSpec.instructionSpecs,
        gameSpec.geometry,
        initialVisibility,
        (playerId, lines) => this.sendToPlayer(playerId, { type: 'instruction', lines }),
        (playerId, eliminated) => this.removePlayer(playerId, eliminated),
        wrappedOnClose,
        (playerId, updates, perPlayer) => this.sendToPlayer(playerId, { type: 'geometry_state', updates, perPlayer }),
        initialRoomVisibility,
        (playerId, updates, perPlayer) => this.sendToPlayer(playerId, { type: 'room_visibility_state', updates, perPlayer }),
        walkableVariants,
        (area) => { this.world.setWalkable(area); this.world.snapAllPlayers() },
        toggleVariants,
        (toggleIds) => { for (const id of toggleIds) this.world.toggleGeometryOff(id) },
        gameSpec.buttons ?? [],
        (id, state, occupancy) => this.broadcast({ type: 'button_state', id, state, occupancy }),
        (id, changes) => this.broadcast({ type: 'button_config', id, changes }),
        (playerId, buttons) => this.sendToPlayer(playerId, { type: 'button_init', buttons }),
        (playerId, text) => this.sendToPlayer(playerId, { type: 'notification', text }),
        (targetId, x, z, event) => {
          this.broadcast({ type: 'player_update', playerId: targetId, x, z, events: [event], serverTick: this.serverTick })
        },
        getRoomAtPosition,
        spawnBotFn,
        (event) => { for (const cb of this.voteRegionChangeCallbacks) cb(event) },
        (assignments) => this.broadcast({ type: 'vote_assignment_change', assignments: Object.fromEntries(assignments) }),
        (playerId, text) => this.sendToPlayer(playerId, { type: 'add_rule', text }),
      )
    }
    this.tickInterval = setInterval(() => this.runTick(), TICK_INTERVAL_MS)
  }

  setCallbackOnVoteRegionsChange(callback: (event: ActiveVoteRegionChangeEvent) => void): void {
    this.voteRegionChangeCallbacks.push(callback)
  }

  clearCallbacks(): void {
    this.voteRegionChangeCallbacks.length = 0
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

  private runTick(): void {
    if (this.closed && this.players.size === 0) {
      clearInterval(this.tickInterval)
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
      const npcEvents = this.npcManager.onActionCompleted(playerEvents)
      const allEvents = npcEvents.length > 0 ? [...playerEvents, ...npcEvents] : playerEvents
      const wp = this.world.getPlayer(playerId)!

      // One move_ack per received client move. All acks for this player share the
      // same final (x, z) — the world position after server tick X. Events attach
      // only to the final ack so the client applies them exactly once.
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
        if (event.type === 'damage' && event.newHp === 0 && this.players.has(event.targetId)) {
          this.removePlayer(event.targetId, true)
        }
      }

      if (this.gameScriptManager && this.players.has(playerId)) {
        this.gameScriptManager.onPlayerMoved(playerId)
      }
    }

    this.pendingMoves.clear()
  }

  addPlayer(playerId: string, ws: WebSocket): void {
    const color = this.pickColor()
    const index = this.nextPlayerIndex++
    this.players.set(playerId, { id: playerId, ws, color, index })
    this.world.addPlayer(playerId)

    const wp = this.world.getPlayer(playerId)!
    this.sendToPlayer(playerId, { type: 'welcome', playerId, color, x: wp.x, z: wp.z, hp: wp.hp, serverTick: this.serverTick })

    // Send map geometry definitions to the new player.
    if (this.geometrySpecs.length > 0) {
      this.sendToPlayer(playerId, { type: 'map_init', geometry: this.geometrySpecs })
    }

    // Inform new player of existing human players, and vice-versa.
    for (const [id, p] of this.players) {
      if (id === playerId) continue
      const ep = this.world.getPlayer(id)!
      this.sendToPlayer(playerId, { type: 'player_joined', playerId: id, color: p.color, x: ep.x, z: ep.z, animState: ep.animState, hp: ep.hp, serverTick: this.serverTick })
      this.sendToPlayer(id, { type: 'player_joined', playerId, color, x: wp.x, z: wp.z, animState: wp.animState, hp: wp.hp, serverTick: this.serverTick })
    }

    // Inform new player of all NPC entities in the world.
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

    // gameScriptManager.onPlayerConnect initialises geometry state and fires the script callback.
    this.gameScriptManager?.onPlayerConnect(playerId)
    console.log(`[Room:${this.roomId}] +player ${playerId} color:${color} (total:${this.players.size})`)
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
    this.gameScriptManager?.onPlayerDisconnect(playerId)
    this.sendToPlayer(playerId, { type: 'player_left', playerId })
    this.players.delete(playerId)
    this.world.removePlayer(playerId)
    this.pendingMoves.delete(playerId)
    this.broadcast({ type: 'player_left', playerId })
    console.log(`[Room:${this.roomId}] -player ${playerId} (total:${this.players.size})`)
    this.maybeTriggerRoomDone()
  }

  private maybeTriggerRoomDone(): void {
    if (!this.closed || this.players.size > 0 || this.roomDoneFired) return
    this.roomDoneFired = true
    this.onRoomDone?.()
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

  protected broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg)
    for (const p of this.players.values()) {
      if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data)
    }
  }

  protected broadcastExcept(excludeId: string, msg: ServerMessage): void {
    const data = JSON.stringify(msg)
    for (const [id, p] of this.players.entries()) {
      if (id !== excludeId && p.ws.readyState === WebSocket.OPEN) p.ws.send(data)
    }
  }

  protected sendToPlayer(playerId: string, msg: ServerMessage): void {
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

  // Generates the ordered sequence of messages an observer needs to reconstruct
  // the current game state from player `playerId`'s perspective.
  getObserverSnapshot(playerId: string): ServerMessage[] {
    const msgs: ServerMessage[] = []
    const p = this.players.get(playerId)
    const wp = this.world.getPlayer(playerId)
    if (!p || !wp) return msgs

    msgs.push({ type: 'welcome', playerId: p.id, color: p.color, x: wp.x, z: wp.z, hp: wp.hp, serverTick: this.serverTick })

    if (this.geometrySpecs.length > 0) {
      msgs.push({ type: 'map_init', geometry: this.geometrySpecs })
    }

    for (const [id, other] of this.players) {
      if (id === playerId) continue
      const ep = this.world.getPlayer(id)
      if (!ep) continue
      msgs.push({ type: 'player_joined', playerId: id, color: other.color, x: ep.x, z: ep.z, animState: ep.animState, hp: ep.hp, serverTick: this.serverTick })
    }

    for (const { id, spec } of this.npcManager.getNpcEntries()) {
      const np = this.world.getPlayer(id)
      if (!np) continue
      msgs.push({ type: 'player_joined', playerId: id, color: NPC_COLOR, x: np.x, z: np.z, animState: np.animState, hp: np.hp, isNpc: true, hasHealth: spec.ux.has_health, serverTick: this.serverTick })
    }

    if (this.gameScriptManager) {
      const { geometryUpdates, roomVisibilityUpdates, buttonData, voteAssignments } = this.gameScriptManager.getPlayerSnapshotData(playerId)
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

export function SetCallbackOnVoteRegionsChange(room: Room, callback: (event: ActiveVoteRegionChangeEvent) => void): void {
  room.setCallbackOnVoteRegionsChange(callback)
}

export function ClearCallbacks(room: Room): void {
  room.clearCallbacks()
}
