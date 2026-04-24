import WebSocket from 'ws'
import type { IncomingMessage } from 'http'
import type { GameMap } from '../../../src/game/GameMap.js'
import type { MultiplayerRoom } from '../Room.js'
import type { ConnectionContext, ConnectionHandler } from '../connections/types.js'
import { MultiplayerRoom as MR } from '../Room.js'
import { parseRoutingKey, parseSrUid } from '../connections/urls.js'

// The `/` flow: every visitor gets a private solo hallway MR immediately (so
// they can walk around while we resolve a target), then is transferred into
// a hub-capable scenario MR that seats them via `acceptHubTransfer`.
//
// This orchestration does NOT own rooms in the shared registry — the solo
// hallway is per-connection and torn down on transfer (or on disconnect via
// autoDestroyOnEmpty). The target room is owned by whichever orchestration
// backs the target routing key; we find it through the registry's
// `findOrCreateHubSlot` using that orchestration, so there's only ever one
// lifecycle owner per room.
export interface DefaultGameOrchestrationOptions {
  // Static hardcoded target for the first-pass hub. A future iteration will
  // round-robin across any scenario whose spec declares a `hubConnection`.
  targetRoutingKey: string
  // The initial hallway map (rooms/geometry) attached to the solo MR and
  // injected into the target MR during `acceptHubTransfer`.
  initialMap: GameMap
  // Authored spawn inside the hallway's local frame.
  initialHallwaySpawnLocal: { x: number; z: number }
}

export class DefaultGameOrchestration implements ConnectionHandler {
  // Monotonic counter for solo hallway MR ids. Each `/` connection gets a
  // fresh private MR, so these never collide.
  private soloHallwayCounter = 0

  constructor(private readonly options: DefaultGameOrchestrationOptions) {}

  async handle(ws: WebSocket, request: IncomingMessage, ctx: ConnectionContext): Promise<void> {
    const routingKey = parseRoutingKey(request.url)
    if (routingKey !== 'hub') {
      ws.close(4004, 'DefaultGameOrchestration only handles the hub routing key')
      return
    }
    const browserUuid = parseSrUid(request)

    const solo = this.createSoloHallwayRoom(ctx)
    const soloPlayerId = solo.connectPlayer(ws, browserUuid, 'hub')
    ctx.wireWs(ws, solo, soloPlayerId)

    // Find or create a target MR with an open hub slot, then transfer the
    // player over. Any failure leaves the player in the solo MR — they can
    // at least walk around the hallway, and the next reconnect will retry.
    try {
      const targetOrch = await ctx.resolveRoomOrchestration(this.options.targetRoutingKey)
      if (!targetOrch) {
        throw new Error(`No orchestration for hub target ${this.options.targetRoutingKey}`)
      }
      const target = ctx.roomRegistry.findOrCreateHubSlot(this.options.targetRoutingKey, targetOrch)
      if (!target.isHubSlotOpen()) throw new Error('Hub slot closed between discovery and transfer')
      if (ws.readyState !== WebSocket.OPEN) {
        // Player dropped while we were resolving; just tear down.
        solo.destroy()
        return
      }
      solo.releasePlayer(soloPlayerId)
      const newPlayerId = target.acceptHubTransfer(
        ws,
        browserUuid,
        'hub',
        this.options.initialMap,
        this.options.initialHallwaySpawnLocal,
      )
      ctx.rebindWs(ws, target, newPlayerId)
      solo.destroy()
    } catch (err) {
      console.error('[DefaultGameOrchestration] hub transfer failed:', err)
      // Leave the player in the solo MR; they can walk around the hallway
      // and reconnect later. Alternative: close the socket with an error.
    }
  }

  // Build a one-player-scoped MR whose World contains just the initial
  // hallway. The registry never sees this MR — it's privately owned by the
  // connection and torn down when the hub transfer completes (or when the
  // player disconnects before transfer, via the ws close handler calling
  // removePlayer + the MR's own tick loop stopping after closed + empty).
  private createSoloHallwayRoom(ctx: ConnectionContext): MultiplayerRoom {
    this.soloHallwayCounter++
    const room = new MR({
      roomId: `solo-hallway-${this.soloHallwayCounter}`,
      instanceIndex: this.soloHallwayCounter,
      spawnPosition: this.options.initialHallwaySpawnLocal,
      recordingManager: ctx.recordingManager,
      autoDestroyOnEmpty: true,
      // onCloseScenario / onRoomDone are not wired: the solo MR lives
      // outside the registry's lifecycle and is torn down explicitly via
      // `destroy()` after transfer (or auto-destroyed when empty if the
      // player disconnects before transfer completes).
    })
    room.addMap(this.options.initialMap)
    return room
  }
}
