# Game — Implementation

## Relevant Files

```
react-three-capacitor/server/src/
  World.ts              — One-line re-export of ../../src/game/World.js (shared with client)
  Room.ts               — handleMove + runTick: per-tick move buffering, event collection and dispatch, game script hooks
  GameServer.ts         — Player routing, scenario registry
  GameScriptManager.ts  — Vote region tracking, player assignment, game script lifecycle
  types.ts              — WorldEvent union (touched, update_animation_state, DamageEvent)
react-three-capacitor/src/game/
  World.ts              — Shared world simulation (used by both client and server); touched event disabled on client instances
react-three-capacitor/src/network/
  useWebSocket.ts       — Routes DamageEvent and instruction into the store
react-three-capacitor/src/store/
  gameStore.ts          — playerHp map, addNotification(message, durationMs)
react-three-capacitor/src/scene/
  Player.tsx            — Correction step: processes events from move_ack immediately
  RemotePlayers.tsx     — consumeRemoteEvents: processes buffered events from player_update
```

## Move Physics

`World.processMove(playerId, jx, jz, dt)` clamps `dt`, computes displacement at the shared max speed, and runs a three-pass walkable-area check (full move → X-only → Z-only) for wall-sliding. It returns a `WorldEvent[]` containing any `touched` and `update_animation_state` events produced by the move. When the world was created with a Rapier `PhysicsSpec`, the Rapier character controller replaces the AABB walkable-area test and enforces wall collision continuously.

## Touch Detection

Touch pairs are tracked in a `Set` with canonical keys (`smallerId:largerId`). A `touched` event is emitted only on the first frame of capsule overlap. The pair remains active until `setPlayerPosition` is called for either player, at which point the pair is cleared.

## HP and Damage

`World.ts` initialises each player's `hp` to 2. `World.applyDamage(targetId, amount)` decrements HP to a minimum of 0 and returns a `DamageEvent`. NPC code invokes this through its context-facing alias `dealDamage` (see `NpcAbilities.ts`); player-player `touched` events do not trigger damage. The `playerHp` map in `gameStore.ts` is updated when a `DamageEvent` arrives via `move_ack` or `player_update`.

When a player's HP reaches zero the server calls `removePlayer`, which deletes the player from both world and room maps and broadcasts `player_left` to all remaining clients — the same path taken on disconnection.

## Event Flow

`Room.runTick` collects per-player move events from `world.processTick()`, appends NPC events from `NpcManager.onPlayerMove`, then sends the combined array in `move_ack` (to the sender) and `player_update` (to all others). The client processes `move_ack` events immediately in `Player.tsx` step 1; `player_update` events are buffered in `positionBuffer.ts` and released when the shared `renderTickFloat` reaches their server tick.
