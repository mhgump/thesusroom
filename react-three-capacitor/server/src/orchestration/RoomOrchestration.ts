import type { MultiplayerRoom } from '../Room.js'

// Handed to an orchestration when the framework asks it to create a new room.
// The orchestration is expected to wire the room's lifecycle callbacks back
// through `onClose` / `onDestroy` so the framework can maintain its open and
// all-rooms lists.
export interface OrchestrationContext {
  // The routing key this room belongs to (e.g. `r_demo`). Used to pre-bind
  // bot spawns to the same key so scenario-spawned bots reconnect into the
  // same orchestration.
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
}

// A pluggable policy for how a multiplayer room is assembled, populated, and
// retired. Implementations decide the world/map/scenario shape and the
// "still open?" predicate.
export interface RoomOrchestration {
  // Build fresh mutable state for one room. The framework calls this when it
  // needs a new open room for this routing key. The returned room is ready
  // to accept player connections via `connectPlayer(ws)`.
  createRoom(ctx: OrchestrationContext): MultiplayerRoom
  // Whether the given room still accepts new connections. The router reads
  // this only when a room is already in its open list — a `false` result
  // prompts the router to remove it. State transitions out of the open list
  // are normally driven by the `onClose` callback, not by polling `isOpen`.
  isOpen(room: MultiplayerRoom): boolean
}

// Resolves a routing key to the orchestration that should govern its rooms.
// Returns `null` for unknown/invalid keys (the router rejects such
// connections with close code 4004).
export type RoutingResolver = (routingKey: string) => RoomOrchestration | null
