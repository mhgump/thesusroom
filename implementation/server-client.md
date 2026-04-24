# Server–Client Protocol — Implementation

## Relevant Files

```
src/game/
  World.ts               — Shared physics (server re-exports from this file); exports TICK_RATE_HZ; touched disabled on client World instances via constructor arg
src/network/
  positionBuffer.ts      — server_world_tick tracking, render-tick pointer + variable-rate catch-up, position snapshots, event queues, move_ack queue
  useWebSocket.ts        — WebSocket message routing to store and positionBuffer; derives WS URL from page path
  types.ts               — ClientMessage / ServerMessage types (mirrors server/src/types.ts)
src/scene/
  Player.tsx             — Local player: prediction, correction, per-clientTick input history, 20 Hz move dispatch
  RemotePlayers.tsx      — Remote player meshes: render-tick-interpolated positions and events
  GameScene.tsx          — Drives advanceRenderTick once per frame at useFrame priority −3
src/store/
  gameStore.ts           — Player list, connection state (UI-only state; no position/event buffers)
server/src/
  World.ts               — One-line re-export of ../../src/game/World.js; server instances are created with no events disabled, so touched/damage/animation all fire
  Room.ts                — 20 Hz setInterval tick loop, move buffering, sort-by-clientTick, player management, NPC event merge, game script hooks
  GameServer.ts          — WebSocket server; parses scenario id from URL path; uses ScenarioRegistry
  ScenarioRegistry.ts    — Maintains open room instances per scenario; creates rooms on demand
  types.ts               — ServerMessage / ClientMessage types (server-side copy; kept in sync with src/network/types.ts)
```

## Shared World

There is a single `World` implementation at `src/game/World.ts`. The server's `server/src/World.ts` is a one-line `export * from '../../src/game/World.js'` that resolves to the same module at runtime, so client and server share bytes-on-disk identity rather than two maintained copies. `World` stores players in a `Map<string, WorldPlayerState>`. `processMove(playerId, jx, jz, dt)` mutates the player in-place and returns `WorldEvent[]`. `queueMove(playerId, inputs)` stores an ordered array of `{jx, jz, dt}` for the next tick. `processTick()` drains the queue, applies every queued input in order via `processMove`, and returns per-player events. The constructor accepts a string array of event types to disable; `'touched'` is disabled on all client instances. `TICK_RATE_HZ = 20` is the single source of truth for the 50 ms tick period on both sides.

## Server (`Room.ts`, `GameServer.ts`, `ScenarioRegistry.ts`)

`ScenarioRegistry` owns a map from scenario id to `{ map: MapSpec; scenario: ScenarioSpec }` and a separate `openRooms` map from scenario id to open `Room`. `getOrCreateRoom(id)` returns the existing open room or creates a new one (passing an `onCloseScenario` callback that deletes the entry from `openRooms`). `prewarm(id)` pre-creates the room at startup. When `ctx.closeScenario()` is called inside a game script, the callback fires and the room is removed from `openRooms`; the room itself continues running for existing players.

`GameServer` parses the first URL path segment from the WebSocket upgrade request as the scenario id (empty or `/` defaults to `demo`). It calls `ScenarioRegistry.getOrCreateRoom` and rejects the connection with close code 4004 if the result is null. `GameServer` stores a `playerRoom` map (player id → Room) to keep room instances alive as long as any player is connected; entries are removed on disconnect.

`Room` owns a `World` instance (all events enabled), a player map (id → WebSocket + colour), a `pendingMoves: Map<playerId, Array<{clientTick, inputs}>>`, a monotonically increasing `serverTick`, and a `setInterval` driving `runTick()` at `TICK_INTERVAL_MS = 1000 / TICK_RATE_HZ`.

`handleMove(playerId, clientTick, inputs)` appends every incoming move to `pendingMoves[playerId]` unconditionally — moves are never dropped, reordered, or rejected. `runTick()`:

1. Increments `serverTick`.
2. For each player, sorts `pendingMoves` by `clientTick`, flattens all inputs into a single array, and calls `world.queueMove(playerId, flat)`.
3. Calls `world.processTick()` to run all queued inputs and collect per-player events.
4. Merges NPC `onPlayerMove` events into the acting player's event list.
5. For each of the player's received moves, sends one `move_ack` back: `{clientTick, serverTick, x, z, events}`. All acks share the same `(x, z)` (end-of-tick position). Events are attached only to the last ack in the batch so the client applies each event exactly once.
6. For every other connected client, sends one `player_update` per moving player: `{playerId, x, z, events, serverTick}`. `touched` events are filtered so each receiving client sees only the pairs it participates in; all other events go to everyone.
7. For any `damage` event that drops HP to zero, calls `removePlayer(targetId, true)`.
8. Calls `GameScriptManager.onPlayerMoved` for each moving player.

`addPlayer` inserts the player at (0, 0), sends `welcome` (carrying `serverTick`), then exchanges `player_joined` messages between the new player and each existing player (human and NPC), each carrying the current `serverTick` so the receiving client can register it via `registerServerTick`, then calls `GameScriptManager.onPlayerConnect`. `removePlayer` calls `GameScriptManager.onPlayerDisconnect` first, then deletes from both maps and broadcasts `player_left`; it is called on both disconnection and elimination.

The `instruction` message is sent directly to a single player by `Room.sendToPlayer`; it is not broadcast and not subject to the render-tick buffer. It is triggered by the game script's `sendInstruction` capability. On the client, `useWebSocket.ts` converts `instruction` messages into a `showRule` call carrying the supplied rule lines, and the message surfaces as a rule popup (not a notification). Other paths (e.g. `ctx.sendNotification`) call `addNotification` in `gameStore.ts`, which uses a 2000 ms default duration.

## Client Network Layer (`positionBuffer.ts`, `useWebSocket.ts`)

`positionBuffer.ts` is a plain module (no React). Everything is keyed on integer server ticks; wall-clock time is never consulted for gating. Four sections:

**Server/render tick** (`registerServerTick`, `advanceRenderTick`, `getRenderTick`, `getServerWorldTick`): every inbound server message carrying a `serverTick` calls `registerServerTick(tick)`, which updates `serverWorldTick = max(serverWorldTick, tick)` and, on the first call with `serverWorldTick > 0`, initialises `renderTickFloat = serverWorldTick − BUFFER_TICKS`. `BUFFER_TICKS = 5`. `GameScene.tsx` calls `advanceRenderTick(delta)` once per frame at `useFrame` priority −3 (before any consumer reads the render tick). `advanceRenderTick` computes `target = serverWorldTick − BUFFER_TICKS` and advances `renderTickFloat` toward `target` at `delta × TICK_RATE_HZ × speed`. `speed` is 1.0 while `lag < SPEED_LO_MULT × BUFFER_TICKS`, ramps linearly toward 2.0 as `lag` grows to `SPEED_HI_MULT × BUFFER_TICKS`, and is clamped at 2.0 above that (`SPEED_LO_MULT = 1.5`, `SPEED_HI_MULT = 3.0`). `renderTickFloat` is clamped at `target` — it never advances past `server_world_tick − buffer`.

**Position snapshots** (`pushRemotePosition`, `getInterpolatedPos`): per-player arrays of `{tick, x, z}` keyed by `serverTick`, trimmed to a `MAX_BUFFER_AGE_TICKS = 40` window. Same-tick writes replace the previous value so NPC and script updates at the same tick don't double up. `getInterpolatedPos(id)` samples at `renderTickFloat` via binary search + linear interpolation between the two bracketing snapshots; returns the first snapshot while `renderTickFloat ≤ buf[0].tick` and the last while `renderTickFloat ≥ last.tick`.

**Event queues** (`pushRemoteEvents`, `consumeRemoteEvents`): per-player arrays of `{tick, event}`. `consumeRemoteEvents(id)` returns raw `WorldEvent[]` — it shifts and returns the wrapped events while `q[0].tick ≤ renderTickFloat`. The queue itself stores the `serverTick` key but it is not exposed on the returned events.

**move_ack queue** (`pushMoveAck`, `consumeMoveAcks`): a plain FIFO array of `MoveAck = {clientTick, serverTick, x, z, events}`. Acks may arrive faster than the frame loop consumes them (network bunching), so every ack is pushed and the whole array is drained together once per frame.

`useWebSocket.ts` routes each message to the store and `positionBuffer`. Every server message carrying a `serverTick` feeds `registerServerTick` (welcome, player_joined, move_ack, player_update).

## Client Local Player (`Player.tsx`)

`Player.tsx` creates its `World` lazily on the first `useFrame` after `playerId` is set. It maintains:

- `clientPredictiveTick` — monotonic counter, incremented at each 20 Hz send boundary.
- `clientWorldTick` — latest `serverTick` for which an ack has driven reconciliation; acks with `serverTick ≤ clientWorldTick` are stale and do not adjust position.
- `pendingInputs` — frame inputs accumulated in the current 50 ms tick window.
- `tickInputs: Map<clientTick, MoveInput[]>` — every sent tick's inputs, pruned only when the matching `move_ack` arrives. There is no maximum size; a disconnected server would leave entries to grow unbounded until reconnect resets the ref.
- `predictedPosPerTick: Map<clientTick, {x,z}>` — local player's predicted end-of-tick position for correction checks, pruned on the same per-ack schedule as `tickInputs`.

Each frame:

1. **Walkable sync**: if `store.activeWalkable` changed, call `world.setWalkable` then `world.snapAllPlayers()`.
2. **Consume acks**: drain `consumeMoveAcks()`. For each ack: delete its `clientTick` entries from `tickInputs` and `predictedPosPerTick`, and apply any `damage` events immediately. Acks with `serverTick ≤ clientWorldTick` are then skipped. Among the remaining, the ack with the newest `(serverTick, clientTick)` is selected as the reconciliation driver.
3. **Reconcile** (only if a driver exists): advance `clientWorldTick` to the driver's `serverTick`. If the driver's `(x, z)` differs from the recorded predicted end-of-tick by more than `CORRECTION_THRESHOLD = 0.0016` m (or no prediction was recorded for that `clientTick`), snap the local world to the ack position, reset every known remote player in the local world to their latest `getInterpolatedPos` value (so local collision prediction stays consistent), then replay every still-unacked tick in `tickInputs` in ascending order followed by the current frame's `pendingInputs`. Snap the Three group only if the post-replay world position differs from the rendered position by more than the same threshold, and update `animState` if the post-replay state changed.
4. **Predict this frame**: read joystick/tap input, call `world.processMove(playerId, jx, jz, delta)`, push `{jx, jz, dt: delta}` onto `pendingInputs`, and apply any `update_animation_state` events.
5. **Tick boundary**: if `performance.now() − lastTickTime ≥ TICK_MS`, assign the current `pendingInputs` to `tickInputs[tick]`, record the current predicted `(x, z)` to `predictedPosPerTick[tick]`, send `{type: 'move', tick, inputs}`, and increment `clientPredictiveTick`.
6. **Render**: write world position to the Three.js group.

Local input cadence is strictly 20 Hz. Variable-rate playback for remote catch-up lives in `advanceRenderTick`, never in the local input loop — distorting the user's own input cadence would change what the user actually did.

## Client Remote Players (`RemotePlayers.tsx`)

Each remote player starts hidden and becomes visible on the first position snapshot. Each `useFrame`:

- `getInterpolatedPos(id)` samples the remote buffer at the shared `renderTickFloat`; returns `null` while the buffer is empty (mesh stays hidden).
- `consumeRemoteEvents(id)` delivers every event whose tick `≤ renderTickFloat` this frame; events are routed to game (`damage`) and graphics (`update_animation_state`) handlers.

All remote players share the same `renderTickFloat`, so positions and events stay temporally aligned across the scene with no per-player wall-clock bookkeeping.
