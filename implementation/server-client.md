# Server–Client Protocol — Implementation

## Relevant Files

```
src/game/
  World.ts               — Shared physics (identical to server copy; touched disabled on client)
src/network/
  positionBuffer.ts      — Server time tracking, position snapshots, event queues, move_ack slot
  useWebSocket.ts        — WebSocket message routing to store and positionBuffer
  types.ts               — ClientMessage / ServerMessage types (mirrors server/src/types.ts)
src/scene/
  Player.tsx             — Local player: prediction, correction, input history, move dispatch
  RemotePlayers.tsx      — Remote player meshes: interpolated positions, buffered events
src/store/
  gameStore.ts           — Player list, connection state (UI-only state; no position/event buffers)
server/src/
  World.ts               — Shared physics (identical to client copy; all events enabled)
  Room.ts                — Move processing, sequence validation, player management, NPC event merge
  GameServer.ts          — WebSocket server, room routing
  types.ts               — ServerMessage / ClientMessage types (mirrors src/network/types.ts)
```

## Shared World

The same source lives at `src/game/World.ts` and `server/src/World.ts` and must stay byte-for-byte identical. `World` stores players in a `Map<string, WorldPlayerState>`. `processMove()` mutates the player in-place and returns `WorldEvent[]`. The constructor accepts a string array of event types to disable; `'touched'` is disabled on all client instances.

## Server (`Room.ts`, `GameServer.ts`)

`Room` owns a `World` instance (all events enabled), a player map (id → WebSocket + colour), and an expected-sequence map. `processMove` validates seq, advances it, captures timestamps around `world.processMove`, appends NPC events, sends `move_ack` to the sender and `player_update` to all others via `broadcastExcept`. There is no `setInterval` broadcast loop.

`addPlayer` inserts the player at (0, 0), sends `welcome` + `round_config`, then exchanges `player_joined` messages between the new player and each existing player (human and NPC). `removePlayer` deletes from both maps and broadcasts `player_left`.

## Client Network Layer (`positionBuffer.ts`, `useWebSocket.ts`)

`positionBuffer.ts` is a plain module (no React). Four independent sections:

**Server time** (`updateServerTime`, `estimatedServerTime`): a single `{serverTime, clientTime}` anchor updated on every update event. `estimatedServerTime()` = `anchor.serverTime + (Date.now() − anchor.clientTime)`.

**Position snapshots** (`pushRemotePosition`, `getInterpolatedPos`): per-player arrays of `{t, x, z}` keyed by server `endTime`, kept to a 2-second window. `getInterpolatedPos` samples at `estimatedServerTime() − delayMs` via binary search + linear interpolation.

**Event queues** (`pushRemoteEvents`, `consumeRemoteEvents`): per-player queues of `{receiptTime, serverStartTime, serverEndTime, event}`. `consumeRemoteEvents` shifts entries while `max(receiptTime, serverStartTime + delayMs) ≤ Date.now()`, returning each with `remainingMs = max(0, serverEndTime + delayMs − now)`.

**move_ack slot** (`setMoveAck`, `consumeMoveAck`): single nullable variable; `setMoveAck` calls `updateServerTime` before storing.

`useWebSocket.ts` routes messages to the store and positionBuffer. `player_joined` uses `estimatedServerTime()` as the snapshot timestamp (no server timestamps on that message).

## Client Local Player (`Player.tsx`)

`Player.tsx` creates its `World` lazily on the first `useFrame` after `playerId` is set. Each frame:

1. **Correction**: consume `pendingMoveAck`; teleport world to ack position; replay inputs with `seq > ack.seq`; snap visual if correction > 2 cm; process events immediately.
2. **Prediction**: `world.processMove(playerId, jx, jz, delta)`.
3. **Send**: stamp seq, push to input history (capped at 180), call `sendMove`.
4. **Render**: write world position to the Three.js group.

## Client Remote Players (`RemotePlayers.tsx`)

Each remote player starts hidden and becomes visible on the first position snapshot. Each `useFrame`:
- `getInterpolatedPos(id, 250)` — smooth position 250 ms behind estimated server time.
- `consumeRemoteEvents(id, 250)` — delivers events whose play window has elapsed; routes to game and graphics handlers.
