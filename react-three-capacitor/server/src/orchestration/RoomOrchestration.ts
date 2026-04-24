import type { MultiplayerRoom } from '../Room.js'
import type { PlayerRecordingManager } from '../PlayerRecordingManager.js'
import type { ConnectionHandler } from '../connections/types.js'

// Handed to an orchestration by the MultiplayerRoomRegistry when it asks the
// orchestration to create a new room. The orchestration is expected to wire
// the room's lifecycle callbacks back through `onClose` / `onDestroy` so the
// registry can maintain its open and all-rooms lists.
export interface RoomCreationContext {
  // The routing key this room belongs to (e.g. `scenarios/demo`). Used to
  // pre-bind bot spawns to the same key so scenario-spawned bots reconnect
  // into the same orchestration.
  routingKey: string
  // Slot index in the per-key all-rooms array. Becomes the observer `{i}`.
  instanceIndex: number
  // Fires when the room should leave the open list. The orchestration must
  // invoke this exactly once, when its policy says the room no longer
  // accepts new connections.
  onClose: () => void
  // Fires when the room can be cleaned up (last player disconnected after
  // close). The orchestration must invoke this exactly once.
  onDestroy: () => void
  // Manager that captures per-player wire messages for first-minute replay.
  // Orchestrations should forward it to every constructed MultiplayerRoom
  // via `MultiplayerRoomOptions.recordingManager`. Absent in tests or
  // harnesses that don't set up a backend.
  recordingManager?: PlayerRecordingManager
}

// A pluggable policy for how a multiplayer room is assembled, populated, and
// retired. Implementations decide the world/map/scenario shape and the
// "still open?" predicate. Room-creating orchestrations are also
// ConnectionHandlers (see ./connections/types.ts) — the registry consumes the
// RoomOrchestration slice, the dispatcher consumes the ConnectionHandler slice.
export interface RoomOrchestration extends ConnectionHandler {
  // Build fresh mutable state for one room. The registry calls this when it
  // needs a new open room for this routing key. The returned room is ready
  // to accept player connections via `connectPlayer(ws)`.
  createRoom(ctx: RoomCreationContext): MultiplayerRoom
  // Whether the given room still accepts new connections. The registry reads
  // this only when a room is already in its open list — a `false` result
  // prompts the registry to remove it. State transitions out of the open
  // list are normally driven by the `onClose` callback, not by polling
  // `isOpen`.
  isOpen(room: MultiplayerRoom): boolean
}

// Type guard that narrows a ConnectionHandler to a RoomOrchestration — i.e.
// one that can create rooms in the shared registry. Used by the dispatcher
// to expose a `resolveRoomOrchestration(key)` view for handlers like
// `DefaultGameOrchestration` that need to locate the target key's
// registry-backed orchestration.
export function isRoomOrchestration(handler: ConnectionHandler): handler is RoomOrchestration {
  const h = handler as Partial<RoomOrchestration>
  return typeof h.createRoom === 'function' && typeof h.isOpen === 'function'
}

// Resolves a routing key to the handler that should own its connections.
// Async because content is loaded lazily from the data backend on first use.
// Returns `null` for unknown/invalid keys (the dispatcher rejects such
// connections with close code 4004).
export type RoutingResolver = (routingKey: string) => Promise<ConnectionHandler | null>
