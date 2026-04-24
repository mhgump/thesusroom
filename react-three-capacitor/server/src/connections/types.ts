import type WebSocket from 'ws'
import type { IncomingMessage } from 'http'
import type { MultiplayerRoom } from '../Room.js'
import type { MultiplayerRoomRegistry } from '../MultiplayerRoomRegistry.js'
import type { PlayerRecordingManager } from '../PlayerRecordingManager.js'
import type { RoomOrchestration } from '../orchestration/RoomOrchestration.js'
import type { PlayerRecordings } from '../../../../tools/src/_shared/backends/index.js'
import type { ScenarioRunRegistry } from '../scenarioRun/ScenarioRunRegistry.js'

// Top-level abstraction for a class of WebSocket client. Each URL shape maps
// to exactly one handler, and the handler owns the entire lifecycle of the
// connection — deciding whether to seat the player in a room, attach as a
// read-only observer, stream a recording, etc. The dispatcher calls
// `handle()` and the handler is expected to close the socket itself on
// failure.
export interface ConnectionHandler {
  handle(ws: WebSocket, request: IncomingMessage, ctx: ConnectionContext): Promise<void>
}

// Dependencies handed to every handler invocation. Includes the shared room
// registry for all three room-seating orchestrations, plus a small set of
// side-effect callbacks owned by GameServer (ws binding installation,
// observer-ready fan-out, cross-key orchestration lookup).
export interface ConnectionContext {
  roomRegistry: MultiplayerRoomRegistry
  recordingManager?: PlayerRecordingManager
  playerRecordings: PlayerRecordings
  scenarioRunRegistry: ScenarioRunRegistry

  // Install GameServer's per-connection ws message/close handlers bound to
  // `(room, playerId)`. Every room-seating handler calls this exactly once
  // after the player is seated. The binding is mutable — `rebindWs` updates
  // it for hand-offs without reinstalling the listeners.
  wireWs(ws: WebSocket, room: MultiplayerRoom, playerId: string): void
  rebindWs(ws: WebSocket, room: MultiplayerRoom, playerId: string): void

  // Cross-key orchestration lookup. Used by `DefaultGameOrchestration` to
  // resolve the hub-target's orchestration so the registry can build a target
  // room on demand. Returns null for unknown keys.
  resolveRoomOrchestration(routingKey: string): Promise<RoomOrchestration | null>

  // Fires both the GameServer's per-key observer-ready listeners and the
  // scenario-run registry's one-shot ready flag. Called by `ObserveHandler`
  // when an observer ws sends a `ready` client message.
  fireObserverReady(routingKey: string): void
}
