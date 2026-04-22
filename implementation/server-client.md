# Server–Client Protocol — Implementation

## Relevant Files

```
src/game/
  World.ts               — Shared physics (identical to server copy; touched disabled on client)
src/network/
  positionBuffer.ts      — Server time tracking, position snapshots, event queues, move_ack slot
  useWebSocket.ts        — WebSocket message routing to store and positionBuffer; derives WS URL from page path
  types.ts               — ClientMessage / ServerMessage types (mirrors server/src/types.ts)
src/scene/
  Player.tsx             — Local player: prediction, correction, input history, move dispatch
  RemotePlayers.tsx      — Remote player meshes: interpolated positions, buffered events
src/store/
  gameStore.ts           — Player list, connection state (UI-only state; no position/event buffers)
server/src/
  World.ts               — Shared physics (identical to client copy; all events enabled)
  Room.ts                — Move processing, sequence validation, player management, NPC event merge, game script hooks
  GameServer.ts          — WebSocket server; parses scenario id from URL path; uses ScenarioRegistry
  ScenarioRegistry.ts    — Maintains open room instances per scenario; creates rooms on demand
  types.ts               — ServerMessage / ClientMessage types (mirrors src/network/types.ts)
```

## Shared World

The same source lives at `src/game/World.ts` and `server/src/World.ts` and must stay byte-for-byte identical. `World` stores players in a `Map<string, WorldPlayerState>`. `processMove()` mutates the player in-place and returns `WorldEvent[]`. The constructor accepts a string array of event types to disable; `'touched'` is disabled on all client instances.

## Server (`Room.ts`, `GameServer.ts`, `ScenarioRegistry.ts`)

`ScenarioRegistry` owns a map from scenario id to `{ map: MapSpec; scenario: ScenarioSpec }` and a separate `openRooms` map from scenario id to open `Room`. `getOrCreateRoom(id)` returns the existing open room or creates a new one (passing an `onCloseScenario` callback that deletes the entry from `openRooms`). `prewarm(id)` pre-creates the room at startup. When `ctx.closeScenario()` is called inside a game script, the callback fires and the room is removed from `openRooms`; the room itself continues running for existing players.

`GameServer` parses the first URL path segment from the WebSocket upgrade request as the scenario id (empty or `/` defaults to `demo`). It calls `ScenarioRegistry.getOrCreateRoom` and rejects the connection with close code 4004 if the result is null. `GameServer` stores a `playerRoom` map (player id → Room) to keep room instances alive as long as any player is connected; entries are removed on disconnect.

`Room` owns a `World` instance (all events enabled), a player map (id → WebSocket + colour), and an expected-sequence map. `processMove` validates seq, advances it, captures timestamps around `world.processMove`, appends NPC events, sends `move_ack` to the sender and `player_update` to all others via `broadcastExcept`, then calls `GameScriptManager.onPlayerMoved` if a game script is active. There is no `setInterval` broadcast loop.

`addPlayer` inserts the player at (0, 0), sends `welcome` + `player_actions`, then exchanges `player_joined` messages between the new player and each existing player (human and NPC), then calls `GameScriptManager.onPlayerConnect`. `removePlayer` calls `GameScriptManager.onPlayerDisconnect` first, then deletes from both maps and broadcasts `player_left`; it is called on both disconnection and elimination.

The `instruction` message is sent directly to a single player by `Room.sendToPlayer`; it is not broadcast and not subject to the 250 ms delay. It is triggered by the game script's `sendInstruction` capability and displayed on the client as a notification. The `addNotification` method in `gameStore.ts` accepts an optional `durationMs` parameter (default 2000 ms); `instruction` messages display for 5000 ms.

## Client Network Layer (`positionBuffer.ts`, `useWebSocket.ts`)

`positionBuffer.ts` is a plain module (no React). Four independent sections:

**Server time** (`updateServerTime`, `estimatedServerTime`): a single `{serverTime, clientTime}` anchor updated on every update event. `estimatedServerTime()` = `anchor.serverTime + (Date.now() − anchor.clientTime)`.

**Position snapshots** (`pushRemotePosition`, `getInterpolatedPos`): per-player arrays of `{t, x, z}` keyed by server `endTime`, kept to a 2-second window. `getInterpolatedPos` samples at `estimatedServerTime() − delayMs` via binary search + linear interpolation.

**Event queues** (`pushRemoteEvents`, `consumeRemoteEvents`): per-player queues of `{receiptTime, serverStartTime, serverEndTime, event}`. `consumeRemoteEvents` shifts entries while `max(receiptTime, serverStartTime + delayMs) ≤ Date.now()`, returning each with `remainingMs = max(0, serverEndTime + delayMs − now)`.

**move_ack slot** (`setMoveAck`, `consumeMoveAck`): single nullable variable; `setMoveAck` calls `updateServerTime` before storing.

`useWebSocket.ts` routes messages to the store and positionBuffer. `player_joined` uses `estimatedServerTime()` as the snapshot timestamp (no server timestamps on that message).

## Client Local Player (`Player.tsx`)

`Player.tsx` creates its `World` lazily on the first `useFrame` after `playerId` is set. Each frame:

1. **Walkable sync**: if `store.activeWalkable` changed, call `world.setWalkable` then `world.snapPlayer(playerId)` to immediately place the player at the nearest valid position before the next prediction step.
2. **Correction**: consume `pendingMoveAck`; teleport world to ack position; replay inputs with `seq > ack.seq`; snap visual if correction > 2 cm; process events immediately.
3. **Prediction**: `world.processMove(playerId, jx, jz, delta)`.
4. **Send**: stamp seq, push to input history (capped at 180), call `sendMove`.
5. **Render**: write world position to the Three.js group.

## Client Remote Players (`RemotePlayers.tsx`)

Each remote player starts hidden and becomes visible on the first position snapshot. Each `useFrame`:
- `getInterpolatedPos(id, 250)` — smooth position 250 ms behind estimated server time.
- `consumeRemoteEvents(id, 250)` — delivers events whose play window has elapsed; routes to game and graphics handlers.
