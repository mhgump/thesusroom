# Game — Implementation

## Relevant Files

```
react-three-capacitor/server/src/
  World.ts              — One-line re-export of ../../src/game/World.js (shared with client)
  Room.ts               — handleMove + runTick: per-tick move buffering, event collection and dispatch, game script hooks
  GameServer.ts         — Player routing, scenario registry
  GameScriptManager.ts  — Vote region tracking, player assignment, game script lifecycle; mirrors room transitions into `world.setPlayerRoom`
  ScenarioRegistry.ts   — Registers each map instance's scoped room ids and default adjacency with the world at Room construction
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

## Per-Player Room Tracking

`World` holds two maps for this feature: `playerRoom: Map<playerId, scopedRoomId | null>` and `playerAccessibleRoomsOverride: Map<playerId, Set<scopedRoomId>>`. Registered map instances are stored in `mapInstances: Map<mapInstanceId, WorldMapInstance>`, where each `WorldMapInstance` carries the scoped room id list and a scoped `defaultAdjacency: Map<scopedRoomId, scopedRoomId[]>`. Map instances are registered at `Room` construction time from `ScenarioRegistry.getOrCreateRoom` via `room.registerMapInstance` → `world.addMapInstance`, before any player joins.

`setPlayerRoom` is called from `GameScriptManager.onPlayerMoved`: when the per-player `getRoomAtPosition(x, z)` result changes from the previously stored room, the manager writes the new scoped id into its own `playerCurrentRoom` map, mirrors it into `world.setPlayerRoom`, and fires `onPlayerEnterRoom` listeners. `null` room results (player in a corridor / no match) are ignored — the world retains the last observed room rather than flipping to null on every interstitial frame.

`getAccessibleRooms(playerId)` resolves in this order: if `playerAccessibleRoomsOverride` has an entry, return a clone of it; otherwise read the current scoped room from `playerRoom` and scan `mapInstances` in insertion order for the first `defaultAdjacency` entry keyed by that room, returning `{currentRoom, ...adjacency}`. If no instance lists the room it returns `{currentRoom}` alone; if the player has no current room it returns the empty set. `setAccessibleRoomsOverride(playerId, ids | null)` writes or deletes the override. Movement containment is unaffected — walkable geometry (and Rapier walls when present) is the sole physical constraint; these methods exist so future scenarios can read a logical accessible-room set without rederiving it.
