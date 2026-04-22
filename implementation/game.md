# Game — Implementation

## Relevant Files

```
server/src/
  World.ts         — HP tracking, touch-pair detection, move physics
  Room.ts          — processMove: sequence validation, event collection and dispatch
  GameServer.ts    — Round management, action routing, DemoRoom
  types.ts         — WorldEvent union (touched, update_animation_state, DamageEvent)
src/game/
  World.ts         — Client-side world: identical physics, touched event disabled
src/network/
  useWebSocket.ts  — Routes round_config and DamageEvent into the store
src/store/
  gameStore.ts     — playerHp map, availableActions, currentRound
src/scene/
  Player.tsx       — Correction step: processes events from move_ack immediately
  RemotePlayers.tsx — consumeRemoteEvents: processes buffered events from player_update
```

## Move Physics

`World.processMove(playerId, jx, jz, dt)` clamps dt to 100 ms, computes displacement at max speed 4 m/s, and runs a three-pass walkable-area check (full move → X-only → Z-only) for wall-sliding. It returns a `WorldEvent[]` containing any `touched` and `update_animation_state` events produced by the move.

## Touch Detection

Touch pairs are tracked in a `Set` with canonical keys (`smallerId:largerId`). A `touched` event is emitted only on the first frame of capsule overlap. The pair remains active until `setPlayerPosition` is called for either player, at which point the pair is cleared.

## HP and Damage

`World.ts` initialises each player's `hp` to 2. `dealDamage(targetId, amount)` decrements HP to a minimum of 0 and returns a `DamageEvent`. The `playerHp` map in `gameStore.ts` is updated when a `DamageEvent` arrives via `move_ack` or `player_update`.

## Rounds

`GameServer.ts` manages rounds and sends `round_config` to the client on connection and on round change. `round_config` carries the round id and the `availableActions` string array. The store's `availableActions` drives the action button list.

## Event Flow

`Room.processMove` collects move events, appends NPC events from `NpcManager.onActionCompleted`, then sends the combined array in `move_ack` (to the sender) and `player_update` (to all others). The client processes `move_ack` events immediately in `Player.tsx` step 1; `player_update` events are buffered in `positionBuffer.ts` and delivered at estimated server time − 250 ms.
