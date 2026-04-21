import WebSocket from 'ws'
import type { RoundConfig, ServerMessage } from './types.js'
import { World } from './World.js'

// ── Color assignment ──────────────────────────────────────────────────────────

const COLOR_PALETTE = [
  '#e74c3c', '#2ecc71', '#3498db', '#f1c40f',
  '#9b59b6', '#e67e22', '#1abc9c', '#e91e63',
  '#00bcd4', '#8bc34a', '#ff5722', '#795548',
]

function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (d === 0) return 0
  let h = 0
  if (max === r) h = ((g - b) / d + 6) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return (h * 60) % 360
}

function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

// ─────────────────────────────────────────────────────────────────────────────

interface PlayerState {
  id: string
  ws: WebSocket
  color: string
}

export abstract class Room {
  protected readonly roomId: string
  protected players: Map<string, PlayerState> = new Map()
  protected currentRoundIndex = 0
  protected rounds: RoundConfig[] = []
  protected world: World = new World() // server enables all events

  private expectedSeq: Map<string, number> = new Map()

  constructor(roomId: string) {
    this.roomId = roomId
  }

  abstract onAction(playerId: string, action: string): void

  processMove(
    playerId: string,
    seq: number,
    jx: number,
    jz: number,
    dt: number,
  ): void {
    if (!this.players.has(playerId)) return

    // Enforce strict ordering — refuse out-of-order moves
    const expected = this.expectedSeq.get(playerId) ?? 0
    if (seq !== expected) {
      this.sendToPlayer(playerId, {
        type: 'error',
        message: `Expected seq ${expected}, got ${seq}`,
      })
      return
    }
    this.expectedSeq.set(playerId, expected + 1)

    const startTime = Date.now()
    const events = this.world.processMove(playerId, jx, jz, dt)
    const endTime = Date.now()

    const wp = this.world.getPlayer(playerId)!

    // Respond to sender with authoritative position + all triggered events
    this.sendToPlayer(playerId, {
      type: 'move_ack',
      seq,
      x: wp.x,
      z: wp.z,
      events,
      startTime,
      endTime,
    })

    // Forward to all other clients so they can update their remote-player buffers
    this.broadcastExcept(playerId, {
      type: 'player_update',
      playerId,
      x: wp.x,
      z: wp.z,
      events,
      startTime,
      endTime,
    })
  }

  addPlayer(playerId: string, ws: WebSocket): void {
    const color = this.pickColor()
    this.players.set(playerId, { id: playerId, ws, color })
    this.world.addPlayer(playerId)
    this.expectedSeq.set(playerId, 0)

    const wp = this.world.getPlayer(playerId)!

    // Welcome the new player with their id, color, and spawn position
    this.sendToPlayer(playerId, { type: 'welcome', playerId, color, x: wp.x, z: wp.z })
    this.sendRoundConfig(playerId)

    // Catch the new player up on all existing players, and tell existing players
    // about the new one — iterate over players that existed before this one.
    for (const [id, p] of this.players) {
      if (id === playerId) continue
      const ep = this.world.getPlayer(id)!
      // Tell new player about this existing player (with current position + animState)
      this.sendToPlayer(playerId, {
        type: 'player_joined',
        playerId: id,
        color: p.color,
        x: ep.x,
        z: ep.z,
        animState: ep.animState,
      })
      // Tell existing player about the new player
      this.sendToPlayer(id, {
        type: 'player_joined',
        playerId,
        color,
        x: wp.x,
        z: wp.z,
        animState: wp.animState,
      })
    }

    console.log(`[Room:${this.roomId}] +player ${playerId} color:${color} (total:${this.players.size})`)
  }

  removePlayer(playerId: string): void {
    this.players.delete(playerId)
    this.world.removePlayer(playerId)
    this.expectedSeq.delete(playerId)
    this.broadcast({ type: 'player_left', playerId })
    console.log(`[Room:${this.roomId}] -player ${playerId} (total:${this.players.size})`)
  }

  protected get currentRound(): RoundConfig {
    return this.rounds[this.currentRoundIndex]
  }

  protected nextRound(): void {
    this.currentRoundIndex = (this.currentRoundIndex + 1) % this.rounds.length
    // Single round_config message carries both the round id and new actions
    this.broadcast({
      type: 'round_config',
      round: this.currentRound.id,
      actions: [...this.currentRound.availableActions],
    })
    console.log(`[Room:${this.roomId}] round → ${this.currentRound.id}`)
  }

  private sendRoundConfig(playerId: string): void {
    this.sendToPlayer(playerId, {
      type: 'round_config',
      round: this.currentRound.id,
      actions: [...this.currentRound.availableActions],
    })
  }

  private pickColor(): string {
    const usedColors = [...this.players.values()].map((p) => p.color)
    const candidates = COLOR_PALETTE.filter((c) => !usedColors.includes(c))
    const pool = candidates.length > 0 ? candidates : COLOR_PALETTE
    if (usedColors.length === 0) return pool[0]
    const usedHues = usedColors.map(hexToHue)
    let best = pool[0], bestDist = -1
    for (const c of pool) {
      const minDist = Math.min(...usedHues.map((uh) => hueDist(hexToHue(c), uh)))
      if (minDist > bestDist) { bestDist = minDist; best = c }
    }
    return best
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
