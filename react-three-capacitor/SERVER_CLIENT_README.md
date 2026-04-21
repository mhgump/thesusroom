# Spec

- Clients and the server share the exact same world implementation — the same physics constants and event logic run on both sides.
- The world tracks each player's position and animation state (idle or walking).
- A move is processed given a joystick direction and a delta time. It updates position (clamped to room bounds, max speed 4 m/s, delta capped at 100 ms) and evaluates animation state.
- An animation state change event is emitted when a move causes a transition between idle and walking. It is not emitted for moves that leave animation state unchanged.
- "Touched" is a world event emitted when two players' capsules first overlap during a move (leading edge only — sustained overlap does not re-emit). Touch pairs are tracked internally; a pair resets when either player's position is teleported.
- World instances can disable individual event types. Disabled types are still simulated; they simply do not appear in the returned event list.
- Client world instances disable "Touched". A Touched event is only ever received from the server, never produced locally.
- Every client move is sent to the server with a monotonically increasing sequence number, joystick direction, and frame delta time.
- The server refuses to process any move whose sequence number is not exactly the next expected value for that player. Out-of-order moves receive an error and are dropped; the expected sequence is not advanced.
- The server processes accepted moves against its authoritative world simulation.
- For each accepted move the server sends the originator a move acknowledgement containing the echoed sequence number, the authoritative position, the triggered events, and server timestamps bracketing the move.
- The server forwards the same result to every other connected client as a position broadcast containing the moving player's id, the authoritative position, the events, and the same timestamps.
- There is no periodic broadcast loop. All position and event updates are sent strictly in response to client moves.
- Move acknowledgements and position broadcasts are update events. They carry authoritative server timestamps and drive the client's server-time estimate.
- Animation state changes and touch events are internal world events. When carried inside an update event, they inherit that update event's timestamps.
- The client maintains a running estimate of current server time. This estimate is anchored to the `endTime` of the most recently received update event and is advanced from that anchor using the local wall clock.
- The client applies every move through its own local world instance immediately when the move is sent (client-side prediction). The local player's visual position and animation state follow this predicted state each frame.
- The client maintains an input history of up to 180 frames (≈3 s at 60 fps), recording the sequence number, joystick direction, and delta time for each sent move.
- When the client receives a move acknowledgement, it immediately teleports the local world to the authoritative position, replays all recorded inputs after the acknowledged sequence, then snaps the visual if the corrected position differs from the current visual by more than 2 cm. Server events in the acknowledgement are processed in the same frame with no delay.
- Remote player positions are stored as snapshots keyed by the server timestamp of the update event that carried them.
- Remote positions are rendered at estimated server time minus 250 ms via linear interpolation between the two bracketing snapshots.
- Remote internal events are held in a per-player queue and delivered exactly once when the later of receipt time and server start time plus 250 ms has elapsed. Late-arriving events are delivered immediately.
- Each delivered event carries how much of its server-time window remained at the moment of delivery.
- Both the position and event streams use the same 250 ms delay, keeping them temporally aligned: an animation change becomes visible at the same moment the matching movement becomes visible.
- When a client receives a Touched event through the remote buffer, it is subject to the 250 ms delay. When a client receives a Touched event in a move acknowledgement, it is processed immediately.
- Touched events are presented as notifications rendered in a column at the top center of the screen. Each notification expires after 2 seconds.
- On connection the server sends the new player: (1) a `welcome` with their assigned id, color, and spawn position; (2) a `round_config` with the current round id and available actions; (3) a `player_joined` for each already-connected player with that player's current position and animation state.
- On connection the server sends a `player_joined` to every already-connected player describing the new player's id, color, spawn position, and initial animation state. `player_joined` carries no server timestamps.
- On disconnection the server removes the player from the world (clearing their touch pairs) and broadcasts `player_left` to all remaining players.
- A single `round_config` message is used for both the initial round state on join and any subsequent round changes.
- Player colors are assigned from a 12-color palette by maximizing the minimum hue distance from colors already in use.
- All messages are JSON-encoded WebSocket frames.

---

# Implementation

## Shared world (`World.ts`)

The same source file lives at `src/game/World.ts` (client) and `server/src/World.ts` (server). The two files are kept byte-for-byte identical. They are compiled independently — the client uses a Vite/browser build and the server uses a Node ESM build. The class imports nothing from the rest of the application.

`World` stores players in a `Map<string, WorldPlayerState>`. Calling `processMove()` mutates the player in-place and returns a `WorldEvent[]`. The `touchingPairs` set uses a canonical key (`smallerId:largerId`) so pair state is consistent regardless of which player is the mover. `setPlayerPosition()` clears all touch pairs for the given player because a teleport invalidates the continuous-contact assumption. Disabled event types are passed as a string array to the constructor; `'touched'` is disabled on all client `World` instances.

## Server (`Room.ts`, `GameServer.ts`)

`Room` is abstract. It owns a `World` instance (all events enabled), a map of connected players (id → WebSocket + color), and a map of expected sequence numbers. `DemoRoom` extends it with a concrete `rounds` array and `onAction` implementation.

`processMove()` checks the expected seq, advances it, captures `startTime = Date.now()`, calls `world.processMove()`, captures `endTime = Date.now()`, sends `move_ack` to the sender, and sends `player_update` to everyone else via `broadcastExcept`. Both messages carry the same `events` array and the same `startTime`/`endTime` pair.

There is no `setInterval` broadcast loop. All updates are driven by incoming client moves.

`addPlayer` inserts the player into the world at (0, 0), sends `welcome` + `round_config`, then iterates existing players to exchange `player_joined` messages in both directions. `removePlayer` deletes from both the player map and the world, then broadcasts `player_left`.

## Client network layer (`positionBuffer.ts`, `useWebSocket.ts`)

`positionBuffer.ts` is a plain module with no React dependency. It has four independent sections:

- **Server time tracking** (`updateServerTime`, `estimatedServerTime`): a single anchor `{serverTime, clientTime}` updated whenever an update event is received. `estimatedServerTime()` returns `anchor.serverTime + (Date.now() - anchor.clientTime)`. This gives a running estimate that advances in real time from the last known server timestamp.

- **Position snapshots** (`pushRemotePosition`, `getInterpolatedPos`): a per-player array of `{t, x, z}` entries keyed by server `endTime`, kept to a 2-second window. `getInterpolatedPos` samples at `estimatedServerTime() - delayMs` using binary search and linear interpolation between the two bracketing entries.

- **Event queues** (`pushRemoteEvents`, `consumeRemoteEvents`): a per-player queue of `{receiptTime, serverStartTime, serverEndTime, event}` entries. `consumeRemoteEvents` shifts entries off the front while `max(receiptTime, serverStartTime + delayMs) ≤ Date.now()`, returning each consumed entry with `event` and `remainingMs = max(0, serverEndTime + delayMs - now)`.

- **move_ack slot** (`setMoveAck`, `consumeMoveAck`): a single nullable variable holding the latest ack by seq. `setMoveAck` calls `updateServerTime(serverEndTime)` before storing. `consumeMoveAck` returns and clears the slot; called once per frame by `Player.tsx`.

`useWebSocket.ts` registers a single message handler and routes:
- `welcome` → store (playerId, color, initialPosition, connected)
- `round_config` → store (round, actions)
- `player_joined` → store (add remote player with initial animState) + `pushRemotePosition` using `estimatedServerTime()` as the timestamp (no server timestamps on this message)
- `player_left` → store (remove) + `clearRemotePlayer`
- `move_ack` → `setMoveAck` (which also updates the server time anchor)
- `player_update` → `updateServerTime(msg.endTime)` + `pushRemotePosition(msg.endTime)` + `pushRemoteEvents(msg.startTime, msg.endTime)`

## Client local player (`Player.tsx`)

`Player` creates its `World` instance lazily in the first `useFrame` call after `playerId` becomes available, seeding it with the spawn position from the store (set by `welcome`). The `useFrame` loop runs four steps every frame:

1. **Correction**: consume `pendingMoveAck`; teleport world to ack position; replay inputs with `seq > ack.seq`; sync visual animState; snap visual position if correction exceeds 2 cm; process any `touched` events in the ack immediately with no delay.
2. **Prediction**: call `world.processMove(playerId, jx, jz, delta)`; handle any `update_animation_state` events.
3. **Send**: stamp a seq number, push to input history (capped at 180), call `sendMove`.
4. **Render**: write the world player's `x`/`z` directly to the Three.js group position.

The `touched` event is disabled in the client's `World`, so step 2 never produces one. Touch notifications for the local player only appear via step 1 (from the server's ack).

## Client remote players (`RemotePlayers.tsx`)

Each remote player renders via a `RemotePlayerMesh` component. The component starts hidden (`visible={false}`) and becomes visible once the first position snapshot arrives. In `useFrame`:
- `getInterpolatedPos(id, 250)` provides a smooth position sampled at `estimatedServerTime() − 250 ms`.
- `consumeRemoteEvents(id, 250)` delivers events whose play window has been reached. `update_animation_state` events update the component's `animState`; `touched` events call `addNotification`. The `remainingMs` field on each consumed event is available but not currently used.

## Notifications (`gameStore.ts`, `Notifications.tsx`)

`addNotification` in the Zustand store appends an entry with a unique id and `expiresAt = Date.now() + 2000`, then schedules a `setTimeout` to filter it out after 2 seconds. The `Notifications` component is a pure subscriber — it renders whatever is in `notifications` and adds no timers of its own.

---

# Expectations for future developers

- **Keep `World.ts` files identical.** The client and server files at `src/game/World.ts` and `server/src/World.ts` must always contain the same source. When you change physics constants, movement logic, collision detection, or add a new world event, update both files. A diff between them is a bug.

- **All physics belongs in `World.ts`.** Do not compute positions, apply speed, or check collisions anywhere else. `Player.tsx` and `Room.ts` call `world.processMove()` — they do not implement movement themselves.

- **Adding a new world event type.** Add it to `WorldEventType`, define its interface, add it to the `WorldEvent` union, and add emit logic inside `processMove()` in both `World.ts` files. Then decide whether clients should disable it. If so, pass its type string in the `new World([...])` constructor call in `Player.tsx`. Handle it in `Player.tsx` (ack events, step 1) and in `RemotePlayerMesh.useFrame` (buffered events).

- **The server never guesses or extrapolates.** It only processes what the client sends. Do not add server-side position prediction, dead-reckoning, or timeout-based movement for idle players.

- **Do not add a broadcast loop.** The architecture is event-driven: updates are sent in response to moves, not on a timer. A periodic broadcast would re-introduce temporal decoupling and flood clients with redundant data.

- **Every update event must update the server time anchor.** Both `move_ack` and `player_update` carry authoritative server timestamps and must call `updateServerTime`. Do not handle only one of them. The position interpolation in `getInterpolatedPos` depends on `estimatedServerTime()` being current; a stale anchor causes remote players to render at the wrong time.

- **Do not revert position snapshots to client receipt time.** Snapshots are keyed by server `endTime`, not by `Date.now()` at receipt. The interpolation target is `estimatedServerTime() − delayMs`, which is in server-time space. Storing snapshots by client receipt time would misalign the position and event streams, since events are still scheduled in server-time space.

- **The `playAt` formula for events must stay intact.** Events are delivered at `max(receiptTime, serverStartTime + delayMs)`. The `max` is intentional: it handles the late-arrival case, where a message arrives after its scheduled play time and should be delivered immediately. Changing this to `receiptTime + delayMs` would break that fast-forward behavior and cause events to play too late for high-latency arrivals.

- **`remainingMs` in consumed events is reserved for future use; do not remove it.** Each consumed event carries `remainingMs = max(0, serverEndTime + delayMs - now)`. No current handler reads it, but it is the correct signal for effects that should scale with how much of the event's server-time window remains (e.g., a flash that shortens if the event arrives late). Keep it in `consumeRemoteEvents`.

- **Sequence numbers reset on reconnect.** `expectedSeq` on the server is set to 0 when a player is added. `seqRef` on the client resets when the `World` is re-initialized (when `playerId` changes). A reconnecting client gets a new `playerId`, triggering a fresh init on both sides. Do not attempt to resume a sequence across reconnections.

- **Input history is bounded.** The client keeps at most 180 frames of input history. A `move_ack` for a seq older than `currentSeq − 180` may not be fully replayable. For typical latencies this is fine; if you extend the game to tolerate higher latencies, increase `INPUT_HISTORY_MAX` in `Player.tsx`.

- **Adding a new room type.** Extend `Room`, define a `rounds` array, implement `onAction`, and register the room in `GameServer.ts`. The `World` instance and the entire move/event pipeline are inherited from `Room` and require no changes.

- **Updating the message protocol.** Change `ServerMessage` or `ClientMessage` in `src/network/types.ts` and mirror the change identically in `server/src/types.ts`. Both files re-export `WorldEvent` types from their respective `World.ts` — do not duplicate those definitions inline.

- **Do not put position or event buffer state in Zustand.** Remote player positions update at up to 60 Hz per player. Storing them in Zustand would trigger a React re-render every frame for every remote player. `positionBuffer.ts` is intentionally a plain module; Three.js mutations in `useFrame` bypass React entirely. Only state that drives UI re-renders (player list, notifications, round info, connection status) belongs in the store.
