# Game Script — Implementation

## Relevant Files

```
react-three-capacitor/server/src/
  GameSpec.ts            — Type definitions: InstructionEventSpec, VoteRegionSpec, FloorGeometrySpec, GameSpec, validateGameSpec
  GameScript.ts          — Event types (ToggleVoteRegionOnEvent, ToggleVoteRegionOffEvent, InstructionEvent),
                           GameScriptContext interface (including closeScenario, setGeometryVisible, setRoomVisible,
                           getVoteAssignments, onPlayerEnterRoom — all room-scoped APIs use scoped ids),
                           GameScript interface
  GameScriptManager.ts   — Runtime: vote region state, player tracking, per-player geometry visibility,
                           per-player current scoped room, listener dispatch, context factory
  ScenarioRegistry.ts    — ScenarioSpec interface (including requiredRoomIds, initialRoomVisibility);
                           creates Room instances on demand via scriptFactory; asserts requiredRoomIds;
                           calls Room.registerMapInstance with scoped room ids and default adjacency
  Room.ts                — Integrates GameScriptManager; calls onPlayerConnect, onPlayerDisconnect, onPlayerMoved;
                           exposes registerMapInstance which forwards to world.addMapInstance
react-three-capacitor/src/game/
  World.ts               — WorldMapInstance interface; addMapInstance, getPlayerRoom, setPlayerRoom,
                           getAccessibleRooms, setAccessibleRoomsOverride
  GameSpec.ts            — Client-side mirror of server/src/GameSpec.ts (type definitions only)
content/server/
  maps/demo.ts           — Demo map spec: walkable area, NPC specs, vote region specs
  maps/scenario1.ts      — Scenario 1 map spec: vote region specs, floor geometry specs
  maps/scenario2.ts      — Scenario 2 map spec: vote region specs
  scenarios/demo.ts      — Demo scenario spec: instruction specs, scriptFactory
  scenarios/scenario1.ts — Scenario 1 spec: instruction specs, initialVisibility, scriptFactory
  scenarios/scenario2.ts — Scenario 2 spec: instruction specs, scriptFactory
content/client/
  maps/demo.ts           — Demo map spec (client): WorldSpec, walkable area, camera shapes, DEMO_GAME_SPEC
  maps/scenario1.ts      — Scenario 1 client map: WorldSpec, GameSpec with vote regions and geometry
  maps/scenario2.ts      — Scenario 2 client map: WorldSpec, GameSpec with vote regions
  maps/index.ts          — Exports CURRENT_MAP resolved by CURRENT_SCENARIO_ID
react-three-capacitor/src/network/
  useWebSocket.ts        — instruction message → store.showRule with the rule lines supplied by the server
```

## Architecture

`GameSpec` and the `GameScript` interface live in separate files from the manager so scripts can import only the interface they implement without pulling in runtime dependencies.

`ScenarioSpec` uses a `scriptFactory: () => GameScript` function rather than a single script instance. `ScenarioRegistry.getOrCreateRoom` calls `scenario.scriptFactory()` each time a new `Room` is created, ensuring every room gets a fresh script with no stale state from prior rooms.

A scenario is "attached" to a world instance at room construction time. In the current deployment each websocket `Room` hosts exactly one `World`, one map instance, and one scenario; the scenario remains open (accepting new connections) until `ctx.closeScenario()` fires, after which the room is destroyed once its last attached player disconnects.

`GameScriptManager` owns:
- `activeRegions: Set<string>` — region ids currently enabled via `toggleVoteRegion`
- `playerRegions: Map<string, string | null>` — every connected player mapped to their current region id
- `playerGeometry: Map<string, Record<string, boolean>>` — per-player geometry visibility state (player id → geometry id → visible)
- `globalGeomVisible: Map<string, boolean>` — global (all-player) visibility state used to evaluate walkable variants
- `walkableVariants: Array<{ triggerIds: Set<string>; walkable: WalkableArea }>` — ordered list of variants; first fully-triggered variant wins
- `voteListeners` array — registered `onVoteChanged` callbacks with their watched region id sets

`Room` creates a `GameScriptManager` in its constructor whenever `gameSpec` is provided. The manager receives four callbacks into Room: `sendInstruction` (sends an `{ type: 'instruction', text }` message to a specific player), `removePlayer` (calls `Room.removePlayer`), `onCloseScenario` (supplied by `ScenarioRegistry` to remove the room from the open registry), and `sendGeometryState` (sends a `{ type: 'geometry_state', updates }` message to a specific player).

## Scenario Attachment Assertion

`ScenarioRegistry.getOrCreateRoom` builds the set of scoped room ids available in the attached map instance as `{mapInstanceId}_{localId}` for every room in `map.worldSpec.rooms`. If `scenario.requiredRoomIds` is non-empty, any id not in that set throws:

```
Scenario '<id>' requires room ids not present in map '<mapInstanceId>': <missing ids>
```

The throw happens before the `Room` is constructed, so a content bug surfaces immediately rather than producing a silently inert script.

After construction, `ScenarioRegistry` computes `defaultAdjacency` by calling `map.getAdjacentRoomIds(scopedId)` for every scoped id, then calls `room.registerMapInstance({ mapInstanceId, scopedRoomIds, defaultAdjacency })`. `Room.registerMapInstance` forwards the instance to `World.addMapInstance` so `World.getAccessibleRooms` can resolve scoped ids via the map's connection graph.

## Scoped Room Ids in Callbacks

All room-scoped APIs on `GameScriptContext` use scoped ids of the form `{mapInstanceId}_{localRoomId}`:

- `setRoomVisible(roomIds, visible, playerIds?)` — `roomIds` entries are scoped.
- `onPlayerEnterRoom(callback)` — the callback receives `(playerId, scopedRoomId)`.
- `ScenarioSpec.initialRoomVisibility` — keyed by scoped ids.

`GameScriptManager` tracks `playerCurrentRoom: Map<string, string | null>`. `onPlayerMoved` invokes `getRoomAtPosition(x, z)` (supplied by the map) to resolve the player's current scoped room id. When the resolved id is non-null and differs from the stored value, the manager updates `playerCurrentRoom`, mirrors the change into the world, and fires every `roomEnterListener`. A `null` return is treated as "no transition" — the previously stored room id is preserved so corridor travel does not emit spurious enters.

## World.setPlayerRoom Sync During onPlayerMoved

Immediately before notifying `roomEnterListeners`, `GameScriptManager.onPlayerMoved` calls `this.world.setPlayerRoom(playerId, newRoom)`. This keeps `World.playerRoom` — the source of truth consumed by `World.getAccessibleRooms` — aligned with the room transitions the script observes through `onPlayerEnterRoom`. Without this call, script-visible room events and the world's accessible-rooms resolution would drift, since no other site updates `playerRoom` during player movement.

The spec permits restricting an attached player's accessible rooms to a subset of the scenario's rooms, but no code currently calls `World.setAccessibleRoomsOverride`; containment in the current deployment is enforced by the walkable area plus geometry toggles.

## Lifecycle Integration in Room

| Room event | GameScriptManager call |
|---|---|
| `addPlayer` | `onPlayerConnect(playerId)` — adds player to tracking, initialises per-player geometry state, sends initial geometry visibility, fires script callback |
| `removePlayer` | `onPlayerDisconnect(playerId)` — removes player from region and geometry tracking before maps are cleared |
| `processMove` (after damage pass) | `onPlayerMoved(playerId)` — recomputes region, notifies listeners if changed |

`onPlayerMoved` is called only when `this.players.has(playerId)` is true, so it is skipped for players eliminated earlier in the same `processMove` call (e.g., by a damage event).

## Vote Region Tracking

After each `processMove`, `onPlayerMoved` calls `regionAt(x, z)` which iterates active regions and returns the first whose Euclidean distance from the player is ≤ radius. If the result differs from the stored region, `playerRegions` is updated and `notifyListeners` fires all registered callbacks whose watched set intersects the changed region ids.

## Geometry Visibility

On `onPlayerConnect`, each player receives the initial geometry state derived from `initialVisibility` (defaulting to visible for any geometry id not listed). The `sendGeometryState` callback is called immediately with all geometry ids and their resolved initial visibility.

`ctx.setGeometryVisible(ids, visible, playerIds?)` updates `playerGeometry` for each target player and calls `sendGeometryState` per player. If `playerIds` is omitted or empty, all connected players are targeted.

## Walkable Variants

`GameScriptManager.checkWalkableVariants()` is called from `setGeometryVisible` whenever a global (all-player) visibility change occurs. It iterates `walkableVariants` in order and calls `onWalkableUpdate(v.walkable)` for the first variant whose every trigger id is currently visible in `globalGeomVisible`. `onWalkableUpdate` is the callback supplied by `Room` at construction; it calls `world.setWalkable(area)` followed immediately by `world.snapAllPlayers()`. `snapAllPlayers` iterates every player and, for any whose current `(x, z)` is outside all new walkable rects, replaces their position with the nearest valid point (axis-aligned rect clamp). The corrected position is then sent to the affected client on the next `move_ack` cycle.

The client mirrors this in `Player.tsx`: when `store.activeWalkable` changes (set by `useWebSocket.ts` on `geometry_state`), `world.setWalkable` is called and `world.snapPlayer(playerId)` is called immediately after, preventing the local player from being frozen for the duration of the move-ack round trip.

## Re-entrancy Safety

`Room.removePlayer` is safe to call from within a `GameScriptManager` callback (e.g., from `ctx.eliminatePlayer`). The call stack is:

```
Room.processMove
  → GameScriptManager.onPlayerMoved
    → notifyListeners → script callback
      → ctx.eliminatePlayer → Room.removePlayer
        → GameScriptManager.onPlayerDisconnect (removes from playerRegions, playerGeometry)
        → players/world maps cleared, player_left broadcast
  ← returns to Room.processMove; subsequent sendToPlayer for eliminated player is a no-op
```

`Room.processMove` checks `this.players.has(playerId)` before calling `onPlayerMoved`, preventing a double-call if the player was eliminated in the NPC damage pass above.
