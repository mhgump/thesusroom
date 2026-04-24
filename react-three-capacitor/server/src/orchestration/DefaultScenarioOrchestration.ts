import type WebSocket from 'ws'
import type { IncomingMessage } from 'http'
import type { GameMap } from '../../../src/game/GameMap.js'
import type { ScenarioSpec } from '../ContentRegistry.js'
import type { MultiplayerRoom } from '../Room.js'
import type { RoomCreationContext, RoomOrchestration } from './RoomOrchestration.js'
import type { ConnectionContext } from '../connections/types.js'
import { createScenarioRoom } from './scenarioRoom.js'
import { parseRoutingKey, parseSrUid } from '../connections/urls.js'

// Ships the original "one world, one map, one scenario" policy: at most one
// open room per routing key, close via `ctx.closeScenario`, destroy on last
// disconnect. Scenario-spawned bots reconnect into the same routing key.
//
// When `autoStartScenario` is false the scenario is added as the default-open
// scenario but not started — connected players and their ready signals buffer
// inside the scenario until `room.startScenario(id)` is called. Used by the
// run-scenario harness so the scenario only begins once the observer browser
// is recording.
export interface DefaultScenarioOrchestrationOptions {
  tickRateHz?: number
  autoStartScenario?: boolean
  // Forwarded to every room built by this orchestration. Fired when a
  // scenario invokes `ctx.terminate()`.
  onScenarioTerminate?: (scenarioId: string) => void
  // Forwarded to every room built by this orchestration. Fired when a
  // scenario invokes `ctx.exitScenario()`. Set by the resolver to trigger
  // the exit-transfer flow in GameServer.
  onExitScenario?: (sourceRoom: MultiplayerRoom, sourceMap: GameMap, sourceScenario: ScenarioSpec) => void
}

export class DefaultScenarioOrchestration implements RoomOrchestration {
  constructor(
    private readonly map: GameMap,
    private readonly scenario: ScenarioSpec,
    private readonly options?: DefaultScenarioOrchestrationOptions,
  ) {}

  async handle(ws: WebSocket, request: IncomingMessage, ctx: ConnectionContext): Promise<void> {
    const routingKey = parseRoutingKey(request.url)
    if (!routingKey) {
      ws.close(4004, 'Invalid routing key')
      return
    }
    const browserUuid = parseSrUid(request)
    const room = ctx.roomRegistry.getOrCreateOpenRoom(routingKey, this)
    const playerId = room.connectPlayer(ws, browserUuid, routingKey)
    ctx.wireWs(ws, room, playerId)
  }

  createRoom(ctx: RoomCreationContext): MultiplayerRoom {
    return createScenarioRoom({
      ctx,
      map: this.map,
      scenario: this.scenario,
      autoStart: this.options?.autoStartScenario ?? true,
      tickRateHz: this.options?.tickRateHz,
      onScenarioTerminate: this.options?.onScenarioTerminate,
      onExitScenario: this.options?.onExitScenario,
    })
  }

  isOpen(room: MultiplayerRoom): boolean {
    return room.isOpen()
  }
}
