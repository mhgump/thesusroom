import { WebSocketServer, WebSocket } from 'ws'
import type http from 'http'
import type { IncomingMessage } from 'http'
import { ScenarioRegistry } from './ScenarioRegistry.js'
import { BotManager } from './bot/BotManager.js'
import { DEMO_MAP } from '../../../content/server/maps/demo.js'
import { DEMO_SCENARIO } from '../../../content/server/scenarios/demo.js'
import { SCENARIO1_MAP } from '../../../content/server/maps/scenario1.js'
import { SCENARIO1_SCENARIO } from '../../../content/server/scenarios/scenario1.js'
import { SCENARIO2_MAP } from '../../../content/server/maps/scenario2.js'
import { SCENARIO2_SCENARIO } from '../../../content/server/scenarios/scenario2.js'
import { SCENARIO3_MAP } from '../../../content/server/maps/scenario3.js'
import { SCENARIO3_SCENARIO } from '../../../content/server/scenarios/scenario3.js'
import { SCENARIO4_MAP } from '../../../content/server/maps/scenario4.js'
import { SCENARIO4_SCENARIO } from '../../../content/server/scenarios/scenario4.js'
import type { Room } from './Room.js'
import type { ClientMessage } from './types.js'

function parseScenarioId(url: string | undefined): string {
  if (!url) return 'demo'
  const path = url.split('?')[0]
  const name = path.replace(/^\/+/, '').split('/')[0]
  return name || 'demo'
}

function parseObserverParams(url: string | undefined): { scenarioId: string; i: number; j: number } | null {
  if (!url) return null
  const path = url.split('?')[0]
  const match = path.match(/^\/observe\/([^/]+)\/(\d+)\/(\d+)$/)
  if (!match) return null
  return { scenarioId: match[1], i: parseInt(match[2], 10), j: parseInt(match[3], 10) }
}

export class GameServer {
  private readonly wss: WebSocketServer
  private readonly registry: ScenarioRegistry
  private readonly playerRoom: Map<string, Room> = new Map()
  private readonly botManager: BotManager

  constructor(portOrServer: number | http.Server) {
    let botServerUrl: string
    if (typeof portOrServer === 'number') {
      this.wss = new WebSocketServer({ port: portOrServer })
      botServerUrl = `ws://localhost:${portOrServer}`
      console.log(`[GameServer] ws://localhost:${portOrServer}`)
    } else {
      this.wss = new WebSocketServer({ server: portOrServer })
      botServerUrl = `ws://localhost:${process.env.PORT ?? '8080'}`
      console.log('[GameServer] attached to HTTP server')
    }
    this.botManager = new BotManager(botServerUrl)
    this.registry = new ScenarioRegistry([
      { map: DEMO_MAP, scenario: DEMO_SCENARIO },
      { map: SCENARIO1_MAP, scenario: SCENARIO1_SCENARIO },
      { map: SCENARIO2_MAP, scenario: SCENARIO2_SCENARIO },
      { map: SCENARIO3_MAP, scenario: SCENARIO3_SCENARIO },
      { map: SCENARIO4_MAP, scenario: SCENARIO4_SCENARIO },
    ], (scenarioId, spec) => this.botManager.spawnBot(scenarioId, spec))
    this.registry.prewarm('demo')
    this.wss.on('connection', this.handleConnection.bind(this))
  }

  getRegistry(): ScenarioRegistry {
    return this.registry
  }

  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    const observerParams = parseObserverParams(request.url)
    if (observerParams) {
      this.handleObserverConnection(ws, observerParams)
      return
    }

    const scenarioId = parseScenarioId(request.url)
    const room = this.registry.getOrCreateRoom(scenarioId)
    if (!room) {
      ws.close(4004, 'Unknown scenario')
      return
    }

    const playerId = crypto.randomUUID()
    this.playerRoom.set(playerId, room)
    room.addPlayer(playerId, ws)

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage
        if (msg.type === 'move') {
          room.processMove(playerId, msg.seq, msg.jx, msg.jz, msg.dt)
        }
      } catch {
        // ignore malformed messages
      }
    })

    ws.on('close', () => {
      room.removePlayer(playerId)
      this.playerRoom.delete(playerId)
    })
  }

  private handleObserverConnection(ws: WebSocket, { scenarioId, i, j }: { scenarioId: string; i: number; j: number }): void {
    const room = this.registry.getRoomByIndex(scenarioId, i)
    if (!room) {
      ws.close(4004, 'Room not found')
      return
    }
    const playerId = room.getPlayerIdByIndex(j)
    if (!playerId) {
      ws.close(4004, 'Player not found')
      return
    }

    const snapshot = room.getObserverSnapshot(playerId)
    for (const msg of snapshot) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    }

    room.registerObserver(playerId, ws)
    ws.on('close', () => room.unregisterObserver(playerId, ws))
    // Inbound messages from observers are ignored
  }
}
