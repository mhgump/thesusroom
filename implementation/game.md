# Game — Implementation

## Relevant Files

```
server/src/
  World.ts         — HP tracking, touch-pair detection, move physics, per-player action sets
  Room.ts          — processMove: sequence validation, event collection and dispatch
  GameServer.ts    — Action management, player routing, DemoRoom
  types.ts         — WorldEvent union (touched, update_animation_state, DamageEvent)
src/game/
  World.ts         — Client-side world: identical physics, touched event disabled
src/network/
  useWebSocket.ts  — Routes player_actions and DamageEvent into the store
src/store/
  gameStore.ts     — playerHp map, availableActions
src/scene/
  Player.tsx       — Correction step: processes events from move_ack immediately
  RemotePlayers.tsx — consumeRemoteEvents: processes buffered events from player_update
```

## Move Physics

`World.processMove(playerId, jx, jz, dt)` clamps dt to 100 ms, computes displacement at max speed 4 m/s, and runs a three-pass walkable-area check (full move → X-only → Z-only) for wall-sliding. It returns a `WorldEvent[]` containing any `touched` and `update_animation_state` events produced by the move.

## Touch Detection

Touch pairs are tracked in a `Set` with canonical keys (`smallerId:largerId`). A `touched` event is emitted only on the first frame of capsule overlap. The pair remains active until `setPlayerPosition` is called for either player, at which point the pair is cleared.

## HP and Damage

`World.ts` initialises each player's `hp` to 2. `dealDamage(targetId, amount)` decrements HP to a minimum of 0 and returns a `DamageEvent`. Only NPC code calls `dealDamage`; player-player `touched` events do not trigger it. The `playerHp` map in `gameStore.ts` is updated when a `DamageEvent` arrives via `move_ack` or `player_update`.

When a player's HP reaches zero the server calls `removePlayer`, which deletes the player from both world and room maps and broadcasts `player_left` to all remaining clients — the same path taken on disconnection.

## Player Actions

`World.ts` maintains a per-player `Set<string>` of available actions. `addPlayerAction(playerId, action)` and `removePlayerAction(playerId, action)` mutate this set; `getPlayerActions(playerId)` returns a copy as a string array. Callers (NPC code, `GameServer.ts`) are responsible for sending a `player_actions` message to the affected client after each mutation. On connection, `addPlayer` sends `player_actions` with the initial action set derived from the world configuration. The store's `availableActions` drives the action button list.

## Event Flow

`Room.processMove` collects move events, appends NPC events from `NpcManager.onActionCompleted`, then sends the combined array in `move_ack` (to the sender) and `player_update` (to all others). The client processes `move_ack` events immediately in `Player.tsx` step 1; `player_update` events are buffered in `positionBuffer.ts` and delivered at estimated server time − 250 ms.
