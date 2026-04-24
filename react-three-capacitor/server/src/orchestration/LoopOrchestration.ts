import WebSocket from 'ws'
import type { IncomingMessage } from 'http'
import type { BotSpec } from '../bot/BotTypes.js'
import type { ConnectionContext, ConnectionHandler } from '../connections/types.js'
import type { PlayerRecordingManager } from '../PlayerRecordingManager.js'
import type { ScenarioSpec } from '../ContentRegistry.js'
import type { GameMap } from '../../../src/game/GameMap.js'
import { MultiplayerRoom } from '../Room.js'
import { parseRoutingKey, parseSrUid } from '../connections/urls.js'
import { executeExitTransfer } from './exitTransfer.js'
import {
  INITIAL_LOOP_SCENARIO,
  buildLoopTransferredScript,
} from '../../../../assets/initial/loopScript.js'
import { MAP as INITIAL_MAP } from '../../../../assets/initial/map.js'

// Serves the `/loop` routing key. Maintains a single "global" hallway MR at
// any given moment; every /loop connection seats directly on it. When the
// scenario inside that MR fires `ctx.exitScenario()`, the orchestration
// builds a fresh target MR via `executeExitTransfer` (which also transfers
// every seated player, shifts the previous hallway in as the source, and
// destroys the previous MR once its slot is empty), then adopts the new
// target as the global. Each new target MR has `onExitScenario` wired back
// to `advanceFrom`, so the chain self-continues indefinitely.
//
// The orchestration never registers rooms with `MultiplayerRoomRegistry` —
// the cycling singleton is private state, and the per-transfer target
// routing keys minted inside `executeExitTransfer` are informational only
// (no `/exit/...` handler is registered; bots that reconnect under them
// would fail fast with 4004).
export interface LoopOrchestrationOptions {
  spawnBotFn: (routingKey: string, spec: BotSpec) => void
  recordingManager?: PlayerRecordingManager
}

export class LoopOrchestration implements ConnectionHandler {
  private currentRoom: MultiplayerRoom | null = null
  // The GameMap representing the current global hallway — tracked alongside
  // `currentRoom` so chained exit transfers can feed the actual
  // (possibly-shifted) hallway back in as their `sourceMap`. Starts as the
  // authored INITIAL_MAP for the pristine MR; becomes the shifted target
  // hallway after each advance. Without this, subsequent transfers would
  // treat the source as still centred on origin and players would end up
  // outside any walkable room in the new target world.
  private currentHallwayMap: GameMap = INITIAL_MAP
  // Monotonic counter for the pristine hallway MR ids. Each one is distinct
  // even in the face of rapid cycling; informational only, never a routing
  // key clients can reach.
  private pristineCounter = 0

  constructor(
    private readonly options: LoopOrchestrationOptions,
    // Wired by GameServer at construction. `rebindWs` is needed for the
    // transfer-chain path; on first-room connect we just call `wireWs` via
    // the ConnectionContext.
    private readonly rebindWs: (ws: WebSocket, room: MultiplayerRoom, playerId: string) => void,
  ) {}

  async handle(ws: WebSocket, request: IncomingMessage, ctx: ConnectionContext): Promise<void> {
    const routingKey = parseRoutingKey(request.url)
    if (routingKey !== 'loop') {
      ws.close(4004, 'LoopOrchestration only handles the loop routing key')
      return
    }
    const browserUuid = parseSrUid(request)

    if (!this.currentRoom || !this.currentRoom.isOpen()) {
      this.currentRoom = this.createPristineRoom()
      this.currentHallwayMap = INITIAL_MAP
    }
    const playerId = this.currentRoom.connectPlayer(ws, browserUuid, 'loop')
    ctx.wireWs(ws, this.currentRoom, playerId)
  }

  // Build the first-ever hallway MR (no preceding source to transfer from).
  // Runs the pristine loop script, which just counts down to an
  // `ctx.exitScenario()` call; the MR's `onExitScenario` triggers
  // `advanceFrom` so the first transfer kicks off the chain.
  private createPristineRoom(): MultiplayerRoom {
    this.pristineCounter++
    const roomId = `loop-pristine-${this.pristineCounter}`
    let self: MultiplayerRoom | null = null
    const room = new MultiplayerRoom({
      roomId,
      instanceIndex: this.pristineCounter,
      maxPlayers: INITIAL_LOOP_SCENARIO.maxPlayers,
      spawnPosition: INITIAL_LOOP_SCENARIO.spawn ?? { x: 0, z: 0 },
      recordingManager: this.options.recordingManager,
      spawnBotFn: (spec) => this.options.spawnBotFn('loop', spec),
      onExitScenario: () => {
        if (!self) return
        this.advanceFrom(self)
      },
    })
    self = room

    const hallwayRoomIds = room.addMap(INITIAL_MAP)
    const scenario = room.buildScenario(
      hallwayRoomIds,
      {
        id: INITIAL_LOOP_SCENARIO.id,
        script: INITIAL_LOOP_SCENARIO.script,
        instructionSpecs: [],
        voteRegions: [],
        initialVisibility: INITIAL_LOOP_SCENARIO.initialVisibility ?? {},
        initialRoomVisibility: INITIAL_LOOP_SCENARIO.initialRoomVisibility ?? {},
      },
    )
    room.scenarios.add(scenario, { default: true })
    room.startScenario(INITIAL_LOOP_SCENARIO.id)

    console.log(`[loop] created pristine hallway ${roomId}`)
    return room
  }

  // Fired by the current global MR's `ctx.exitScenario()` hook. Triggers
  // the transfer to a fresh target hallway and adopts it as the global.
  // The target MR's own `onExitScenario` is wired back here so the chain
  // continues without any further orchestration-level scheduling.
  private advanceFrom(oldRoom: MultiplayerRoom): void {
    // Synthesise a ScenarioSpec carrying the initial-hallway exitConnection.
    // `executeExitTransfer` only reads `exitConnection` and `id` off this
    // object, so we don't need a full script; the pristine/transferred
    // scripts are attached via the target-scenario builder below.
    const sourceScenarioSpec: ScenarioSpec = {
      id: INITIAL_LOOP_SCENARIO.id,
      script: INITIAL_LOOP_SCENARIO.script,
      timeoutMs: 0,
      maxPlayers: INITIAL_LOOP_SCENARIO.maxPlayers,
      exitConnection: INITIAL_LOOP_SCENARIO.exitConnection,
    }

    try {
      const result = executeExitTransfer({
        sourceRoom: oldRoom,
        // Feed the CURRENTLY-attached hallway (possibly shifted from INITIAL's
        // authored origin) back in as the source, so the attachment math
        // positions the new hallway relative to where players actually are.
        sourceMap: this.currentHallwayMap,
        sourceScenario: sourceScenarioSpec,
        rebindWs: this.rebindWs,
        recordingManager: this.options.recordingManager,
        spawnBotFn: this.options.spawnBotFn,
        buildTargetScenario: buildLoopTransferredScript,
        targetOnExitScenario: (target) => this.advanceFrom(target),
        targetMaxPlayers: INITIAL_LOOP_SCENARIO.maxPlayers,
      })
      this.currentRoom = result.targetRoom
      this.currentHallwayMap = result.targetHallwayMap
    } catch (err) {
      console.error('[loop] advance failed:', err)
      // Recovery: the old MR's scenario has already fired `exitScenario`,
      // which flipped its `advanceFired` guard. Leaving it in place would
      // leave the loop permanently stuck because subsequent connects land
      // on that scenario and onPlayerConnect's guard would skip re-arming
      // the advance timer. Tear it down so the next `/loop` connect
      // observes `!currentRoom.isOpen()` and builds a fresh pristine MR.
      try { oldRoom.closeAndDestroy() } catch (inner) {
        console.error('[loop] closeAndDestroy after failed advance also threw:', inner)
      }
      if (this.currentRoom === oldRoom) {
        this.currentRoom = null
        this.currentHallwayMap = INITIAL_MAP
      }
    }
  }
}
