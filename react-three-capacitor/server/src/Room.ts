import WebSocket from 'ws'
import type { ServerMessage } from './types.js'
import { World } from './World.js'
import type { WalkableArea } from './World.js'
import { NpcManager } from './npc/NpcManager.js'
import type { NpcSpec } from './npc/NpcSpec.js'
import { GameScriptManager } from './GameScriptManager.js'
import type { GameSpec, FloorGeometrySpec } from './GameSpec.js'
import type { GameScript } from './GameScript.js'

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

interface PlayerState { id: string; ws: WebSocket; color: string }

export class Room {
  protected readonly roomId: string
  protected players: Map<string, PlayerState> = new Map()
  protected world: World

  private expectedSeq: Map<string, number> = new Map()
  private npcManager: NpcManager
  private gameScriptManager: GameScriptManager | null = null
  private readonly geometrySpecs: FloorGeometrySpec[]

  constructor(roomId: string, walkable: WalkableArea, npcs: NpcSpec[] = [], gameSpec?: GameSpec, gameScript?: GameScript, onCloseScenario?: () => void, walkableVariants: Array<{ triggerIds: string[]; walkable: WalkableArea }> = []) {
    this.roomId = roomId
    this.world = new World(walkable)
    this.geometrySpecs = gameSpec?.geometry ?? []
    this.npcManager = new NpcManager(this.world, (npcId, x, z, events, time) => {
      this.broadcast({ type: 'player_update', playerId: npcId, x, z, events, startTime: time, endTime: time })
    })
    this.npcManager.spawnAll(npcs)
    if (gameSpec) {
      this.gameScriptManager = new GameScriptManager(
        this.world,
        gameScript ?? null,
        gameSpec.voteRegions,
        gameSpec.instructionSpecs,
        gameSpec.geometry,
        gameSpec.initialVisibility,
        (playerId, text, label) => this.sendToPlayer(playerId, { type: 'instruction', text, label: label as 'RULE' | 'COMMAND' | 'FACT' }),
        (playerId) => this.removePlayer(playerId),
        onCloseScenario ?? (() => {}),
        (playerId, updates) => this.sendToPlayer(playerId, { type: 'geometry_state', updates }),
        walkableVariants,
        (area) => { this.world.setWalkable(area); this.world.snapAllPlayers() },
        gameSpec.buttons,
        (id, state, occupancy) => this.broadcast({ type: 'button_state', id, state, occupancy }),
        (id, changes) => this.broadcast({ type: 'button_config', id, changes }),
        (playerId, buttons) => this.sendToPlayer(playerId, { type: 'button_init', buttons }),
        (playerId, text) => this.sendToPlayer(playerId, { type: 'notification', text }),
      )
    }
  }

  processMove(playerId: string, seq: number, jx: number, jz: number, dt: number): void {
    if (!this.players.has(playerId)) return

    const expected = this.expectedSeq.get(playerId) ?? 0
    if (seq !== expected) {
      this.sendToPlayer(playerId, { type: 'error', message: `Expected seq ${expected}, got ${seq}` })
      return
    }
    this.expectedSeq.set(playerId, expected + 1)

    const startTime = Date.now()
    const moveEvents = this.world.processMove(playerId, jx, jz, dt)
    const npcEvents = this.npcManager.onActionCompleted(moveEvents)
    const endTime = Date.now()

    const allEvents = npcEvents.length > 0 ? [...moveEvents, ...npcEvents] : moveEvents
    const wp = this.world.getPlayer(playerId)!
    this.sendToPlayer(playerId, { type: 'move_ack', seq, x: wp.x, z: wp.z, events: allEvents, startTime, endTime })
    this.broadcastExcept(playerId, { type: 'player_update', playerId, x: wp.x, z: wp.z, events: allEvents, startTime, endTime })

    for (const event of allEvents) {
      if (event.type === 'damage' && event.newHp === 0 && this.players.has(event.targetId)) {
        this.removePlayer(event.targetId)
      }
    }

    if (this.gameScriptManager && this.players.has(playerId)) {
      this.gameScriptManager.onPlayerMoved(playerId)
    }
  }

  addPlayer(playerId: string, ws: WebSocket): void {
    const color = this.pickColor()
    this.players.set(playerId, { id: playerId, ws, color })
    this.world.addPlayer(playerId)
    this.expectedSeq.set(playerId, 0)

    const wp = this.world.getPlayer(playerId)!
    this.sendToPlayer(playerId, { type: 'welcome', playerId, color, x: wp.x, z: wp.z, hp: wp.hp })

    // Send map geometry definitions to the new player.
    if (this.geometrySpecs.length > 0) {
      this.sendToPlayer(playerId, { type: 'map_init', geometry: this.geometrySpecs })
    }

    // Inform new player of existing human players, and vice-versa.
    for (const [id, p] of this.players) {
      if (id === playerId) continue
      const ep = this.world.getPlayer(id)!
      this.sendToPlayer(playerId, { type: 'player_joined', playerId: id, color: p.color, x: ep.x, z: ep.z, animState: ep.animState, hp: ep.hp })
      this.sendToPlayer(id, { type: 'player_joined', playerId, color, x: wp.x, z: wp.z, animState: wp.animState, hp: wp.hp })
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
      })
    }

    // gameScriptManager.onPlayerConnect initialises geometry state and fires the script callback.
    this.gameScriptManager?.onPlayerConnect(playerId)
    console.log(`[Room:${this.roomId}] +player ${playerId} color:${color} (total:${this.players.size})`)
  }

  removePlayer(playerId: string): void {
    this.gameScriptManager?.onPlayerDisconnect(playerId)
    this.sendToPlayer(playerId, { type: 'player_left', playerId })
    this.players.delete(playerId)
    this.world.removePlayer(playerId)
    this.expectedSeq.delete(playerId)
    this.broadcast({ type: 'player_left', playerId })
    console.log(`[Room:${this.roomId}] -player ${playerId} (total:${this.players.size})`)
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
    if (p?.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(msg))
  }
}
