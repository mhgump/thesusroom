import WebSocket from 'ws'
import type { IncomingMessage } from 'http'
import type { GameMap } from '../../../src/game/GameMap.js'
import type { MultiplayerRoom } from '../Room.js'
import type { ConnectionContext, ConnectionHandler } from '../connections/types.js'
import { MultiplayerRoom as MR } from '../Room.js'
import { parseRoutingKey, parseSrUid } from '../connections/urls.js'
import type {
  ChooseExistingMultiplayerRoom,
  ChooseScenario,
  HubDecisionContext,
} from './hubDecisions.js'

// The `/` flow: every visitor gets a private solo hallway MR immediately (so
// they can walk around while we resolve a target), then is transferred into
// a hub-capable scenario MR that seats them via `acceptHubTransfer`.
//
// Target selection is driven by two pluggable hooks:
//   1. `chooseExistingRoom` — scans the live room snapshot and may return an
//      existing room to transfer into.
//   2. `chooseScenario` — if step 1 returns null, picks a scenario whose
//      orchestration should create a fresh room.
// This orchestration never owns rooms in the shared registry: the solo
// hallway is per-connection and torn down on transfer (or on disconnect via
// autoDestroyOnEmpty). The target room is owned by whichever orchestration
// backs the target routing key; we find it through the registry's
// `findOrCreateHubSlot` using that orchestration, so there's only ever one
// lifecycle owner per room.
export interface DefaultGameOrchestrationOptions {
  // Lazy lookup of routing keys whose scenario declares a `hubConnection`.
  // Resolved once on first use and cached; adding new hub-capable scenarios
  // requires a server restart. Returns keys like `scenarios/scenario2`.
  resolveHubTargets: () => Promise<string[]>
  // Decision hooks. Both are consulted on every `/` connection: existing
  // first, scenario as fallback. See `hubDecisions.ts` for the stock
  // implementations.
  chooseExistingRoom: ChooseExistingMultiplayerRoom
  chooseScenario: ChooseScenario
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
  // Cached hub-target list, resolved once on first use.
  private hubTargetsPromise: Promise<string[]> | null = null

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

    // Resolve a target MR (via the two decision hooks) and transfer the
    // player over. Any failure leaves the player in the solo MR — they can
    // at least walk around the hallway, and the next reconnect will retry.
    try {
      const picked = await this.transferPlayerToHub(ws, browserUuid, solo, soloPlayerId, ctx)
      if (!picked) {
        // `null` means either no hub-capable target exists or the ws closed
        // while we were resolving. Tear down the per-connection solo MR
        // either way — nothing else is going to use it.
        solo.destroy()
        return
      }
      solo.destroy()
    } catch (err) {
      console.error('[DefaultGameOrchestration] hub transfer failed:', err)
      // Leave the player in the solo MR; they can walk around the hallway
      // and reconnect later. Alternative: close the socket with an error.
    }
  }

  // Move a connected player from an arbitrary source MR into a hub-capable
  // scenario MR picked by the decision hooks. Returns the picked
  // (routingKey, room) on success, null when no target was available or the
  // ws closed mid-resolve. Throws if the target refused the seat
  // (`acceptHubTransfer` race between `isHubSlotOpen` and seat) — caller
  // decides whether to retry or tear the source down.
  //
  // Used by `handle()` for the `/` solo-hallway → scenario hop and by the
  // exit-hallway reenter flow (GameServer.onExitScenario) to drain a shared
  // hallway MR one player at a time. Does NOT destroy the source room — the
  // source lifecycle belongs to the caller (per-connection destroy for solo,
  // autoDestroyOnEmpty for the shared exit hallway).
  async transferPlayerToHub(
    ws: WebSocket,
    browserUuid: string | null,
    sourceRoom: MultiplayerRoom,
    sourcePlayerId: string,
    ctx: ConnectionContext,
  ): Promise<{ routingKey: string; room: MultiplayerRoom } | null> {
    const picked = await this.resolveTarget(ctx)
    if (!picked) return null
    if (ws.readyState !== WebSocket.OPEN) return null
    sourceRoom.releasePlayer(sourcePlayerId)
    const newPlayerId = picked.room.acceptHubTransfer(
      ws,
      browserUuid,
      picked.routingKey,
      this.options.initialMap,
      this.options.initialHallwaySpawnLocal,
    )
    ctx.rebindWs(ws, picked.room, newPlayerId)
    return picked
  }

  // Run the two-step decision: existing room first, then scenario. Returns
  // the room chosen by whichever hook succeeded, or null if neither could
  // produce a hub-ready room. The existing-room path verifies the snapshot
  // still matches the live room (open + hub slot open); the scenario path
  // goes through `findOrCreateHubSlot`, which either reuses an open room
  // under that key or creates a fresh one via the orchestration.
  private async resolveTarget(ctx: ConnectionContext): Promise<{
    routingKey: string
    room: MultiplayerRoom
  } | null> {
    const hubTargets = await this.resolveTargets()
    const decisionCtx: HubDecisionContext = {
      rooms: ctx.roomRegistry.listRooms(),
      hubTargets,
    }

    const existing = this.options.chooseExistingRoom(decisionCtx)
    if (existing) {
      const room = ctx.roomRegistry.getRoomByIndex(existing.routingKey, existing.instanceIndex)
      // Snapshot → lookup race: the room may have closed or filled up
      // between listRooms() and now. Fall through to the scenario path
      // rather than bubbling the race up as an error.
      if (room && room.isOpen() && room.isHubSlotOpen()) {
        return { routingKey: existing.routingKey, room }
      }
    }

    const scenarioKey = this.options.chooseScenario(decisionCtx)
    if (!scenarioKey) return null
    const orchestration = await ctx.resolveRoomOrchestration(scenarioKey)
    if (!orchestration) return null
    const room = ctx.roomRegistry.findOrCreateHubSlot(scenarioKey, orchestration)
    if (!room.isHubSlotOpen()) return null
    return { routingKey: scenarioKey, room }
  }

  private async resolveTargets(): Promise<string[]> {
    this.hubTargetsPromise ??= this.options.resolveHubTargets()
    return this.hubTargetsPromise
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
      // Per-connection solo hallway: exactly one player seated, no joins.
      maxPlayers: 1,
      // onCloseScenario / onRoomDone are not wired: the solo MR lives
      // outside the registry's lifecycle and is torn down explicitly via
      // `destroy()` after transfer (or auto-destroyed when empty if the
      // player disconnects before transfer completes).
    })
    room.addMap(this.options.initialMap)
    return room
  }
}
