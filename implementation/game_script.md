# Game Script — Implementation

## Relevant Files

```
react-three-capacitor/server/src/
  GameSpec.ts            — Type definitions: InstructionEventSpec, VoteRegionSpec, FloorGeometrySpec, ButtonSpec, ButtonConfig, ButtonState, GameSpec, validateGameSpec
  GameScript.ts          — ActiveVoteRegionChangeEvent, GameScriptContext interface (sendInstruction[s], toggleVoteRegion, onVoteChanged, after, getPlayerIds, getPlayerPosition, eliminatePlayer, closeScenario, setGeometryVisible, setRoomVisible, getVoteAssignments, onButtonPress/Release, modifyButton, setButtonState, sendNotification, applyDamage, onPlayerEnterRoom, spawnBot, lockPlayerToRoom / unlockPlayerFromRoom, addRule), GameScript interface (onPlayerConnect + optional onPlayerReady)
  Scenario.ts            — Runtime: vote-region state, per-attached-player tracking (playerRegions, playerGeometry, playerRoomVisible, playerCurrentRoom), ButtonManager, walkable/toggle variants, vote/room-enter/button listeners, script context factory. Lifecycle: constructor → start() → delete(). requiredRoomIds asserted in the constructor. Scheduled callbacks routed through an alive-gate
  ScenarioManager.ts     — Owns `Map<scenarioId, Scenario>`, tracks which scenario each attached player is on, designates a default-open scenario
  ContentRegistry.ts     — ScenarioSpec interface (id, scriptFactory, initialVisibility, initialRoomVisibility, requiredRoomIds, timeoutMs, onTerminate); pure lookup; the map and scenario are attached to a room by the orchestration
  Room.ts                — `MultiplayerRoom` class integrates `ScenarioManager`: `addMap(gameMap)` registers the map's scoped rooms on the world and spawns its NPCs; `buildScenario(attachedRoomIds, config)` wires a new `Scenario` to the room's broadcast/send channels; `scenarios.add(scenario, { default: true })` makes it the default-open scenario; `handlePlayerReady`, `runTick` forward to the manager
  ButtonManager.ts       — Per-scenario button state; cooldown uses the scenario's alive-gated scheduleSimMs
react-three-capacitor/src/game/
  World.ts               — WorldMapInstance interface; addMap, addMapInstance, getRoomsInMapInstance, getPlayerRoom, setPlayerRoom, getAccessibleRooms, setAccessibleRoomsOverride
  MapInstance.ts         — buildMapInstanceArtifacts: turns a (WorldSpec, mapInstanceId) into scoped room ids + default adjacency + scoped getRoomAtPosition/getAdjacentRoomIds. Consumed by GameMap authoring and by World.addMap
  GameSpec.ts            — Client-side mirror of server/src/GameSpec.ts (type definitions only)
content/
  maps/demo.ts, scenario1..4.ts          — Server-side `GameMap` specs (worldSpec, walkable, physics, gameSpec, npcs, getRoomAtPosition, getAdjacentRoomIds, isRoomOverlapping, walkableVariants, toggleVariants)
  scenarios/demo.ts, scenario1..4.ts     — `ScenarioSpec` (id, scriptFactory, initialVisibility, initialRoomVisibility, requiredRoomIds, timeoutMs, onTerminate)
  client/maps/*                          — Client-side map rendering data
react-three-capacitor/src/network/
  useWebSocket.ts        — instruction message → store.showRule with the rule lines supplied by the server
```

## Architecture

`GameSpec` and the `GameScript` interface live in separate files from the runtime so scripts can import only the interface they implement without pulling in runtime dependencies.

`ScenarioSpec` uses a `scriptFactory: () => GameScript` function rather than a single script instance. `ScenarioManager.add(scenario)` receives a fresh `Scenario` built via `room.buildScenario(..., { script: spec.scriptFactory() })` — every room gets a fresh script with no stale state from prior rooms.

In the current deployment each websocket `MultiplayerRoom` hosts one `World`, one map instance registered via `world.addMap(gameMap)`, and one attached `Scenario` marked as the default-open scenario; the scenario remains open (accepting new connections) until `ctx.closeScenario()` fires, after which the room is closed (no new players routed to it) and, once its last attached player disconnects, the room is destroyed and every scenario it owns is deleted. The `ScenarioManager` supports multiple concurrent scenarios per room, but `DefaultScenarioOrchestration` ships with exactly one.

`Scenario` owns:
- `script: GameScript | null`
- `activeRegions: Set<string>` — region ids currently enabled via `toggleVoteRegion`
- `attachedPlayerIds: Set<string>`, `readyPlayerIds: Set<string>` — insertion-ordered; consulted by `start()` to replay lifecycle callbacks in arrival order
- `playerRegions: Map<string, string | null>` — every attached player mapped to their current vote region id
- `playerGeometry: Map<string, Record<string, boolean>>` — per-player geometry visibility state
- `playerRoomVisible: Map<string, Map<string, boolean>>` — per-player room visibility state
- `playerCurrentRoom: Map<string, string | null>` — per-player last-entered scoped room id
- `globalGeomVisible: Map<string, boolean>` — global (all-player) visibility state used to evaluate walkable/toggle variants
- `walkableVariants`, `toggleVariants` — ordered lists of variants; first fully-triggered variant wins
- `buttonManager: ButtonManager | null`
- `voteListeners`, `roomEnterListeners`, `buttonPressListeners`, `buttonReleaseListeners`

`MultiplayerRoom.buildScenario(attachedRoomIds, config)` wires the Scenario's deps to `sendToPlayer` / `broadcast` / `removePlayer` / `onClose` / `spawnBot` / `scheduleSimMs` / `getRoomAtPosition` / `getServerTick` / `onWalkableUpdate` closures on the room. The `onClose` closure calls `MultiplayerRoom.handleScenarioClose(id)`, which clears the default-open slot and (if the room has no default-open scenario remaining) fires the orchestration's `onClose` to drop the room from the router's open list.

## Scenario Attachment Assertion

The `Scenario` constructor receives the scoped room ids attached to this scenario (a subset of the scoped ids the `World` knows about). If `ScenarioConfig.requiredRoomIds` is non-empty, any id not in the attached set throws:

```
Scenario '<id>' requires room ids not present in attached room set: <missing ids>
```

`DefaultScenarioOrchestration` passes `room.addMap(map)`'s return value as the attached set, so missing ids surface immediately at room construction — a content bug throws before any player can connect. `ScenarioManager.add(scenario)` accepts an already-constructed `Scenario`; the assertion has already happened.

## Scoped Room Ids in Callbacks

All room-scoped APIs on `GameScriptContext` use scoped ids of the form `{mapInstanceId}_{localRoomId}`:

- `setRoomVisible(roomIds, visible, playerIds?)` — `roomIds` entries are scoped.
- `onPlayerEnterRoom(callback)` — the callback receives `(playerId, scopedRoomId)`.
- `ScenarioSpec.initialRoomVisibility` and `requiredRoomIds` — keyed by scoped ids.

`Scenario` tracks `playerCurrentRoom`. `onPlayerMoved` invokes the `getRoomAtPosition(x, z)` supplied by the enclosing `MultiplayerRoom` — composed across every `addMap`-registered map — to resolve the player's current scoped room id. When the resolved id is non-null and differs from the stored value, the scenario updates `playerCurrentRoom`, mirrors the change into the world, and fires every `roomEnterListener`. A `null` return is treated as "no transition" — the previously stored room id is preserved so corridor travel does not emit spurious enters.

## World.setPlayerRoom Sync During onPlayerMoved

Immediately before notifying `roomEnterListeners`, `Scenario.onPlayerMoved` calls `this.deps.world.setPlayerRoom(playerId, newRoom)`. This keeps `World.playerRoom` — the source of truth consumed by `World.getAccessibleRooms` — aligned with the room transitions the script observes through `onPlayerEnterRoom`. Without this call, script-visible room events and the world's accessible-rooms resolution would drift, since no other site updates `playerRoom` during player movement.

The spec permits restricting an attached player's accessible rooms to a subset of the scenario's rooms, but no code currently calls `World.setAccessibleRoomsOverride`; containment in the current deployment is enforced by the walkable area plus geometry toggles.

## Lifecycle Integration in MultiplayerRoom

| Room event | ScenarioManager / Scenario call |
|---|---|
| `connectPlayer` (new WS) | `scenarios.attachPlayerToDefault(playerId)` → `Scenario.onPlayerAttach(playerId)` (initialises per-player geometry / room-visibility / button state; if started, fires `script.onPlayerConnect`; else buffers the id) |
| `handlePlayerReady` | `scenarios.forPlayer(playerId)?.onPlayerReady(playerId)` (records in ready set; if started, fires `script.onPlayerReady`; else buffers the id) |
| `removePlayer` | `scenarios.detachPlayer(playerId)` → `Scenario.onPlayerDetach(playerId)` (clears per-player bookkeeping) |
| `runTick` (after damage pass) | `scenarios.onPlayerMoved(playerId)` → `Scenario.onPlayerMoved(playerId)` (vote region recompute, button occupancy, room enter) |
| `maybeTriggerRoomDone` | `scenarios.destroyAll()` — detaches remaining players from each scenario then deletes each |

`onPlayerMoved` is called only when `this.players.has(playerId)` is true, so it is skipped for players eliminated earlier in the same `runTick` (e.g., by a damage event).

## Scenario States

`Scenario` has three states: **created-not-started**, **started**, and **deleted**. Transitions are one-way.

- **Created-not-started**: `onPlayerAttach` still initialises per-player bookkeeping and sends the initial `geometry_state`, `room_visibility_state`, `button_init` messages, and the id is added to `attachedPlayerIds`. `onPlayerReady` adds to `readyPlayerIds`. Neither fires the script callbacks.
- **Started** (after `start()`): the constructor replays `script.onPlayerConnect` once per buffered attached player (in attach order) followed by `script.onPlayerReady` once per buffered ready player (in ready order). Subsequent attach/ready events flow through the normal path.
- **Deleted** (after `delete()`): `alive = false`. Scheduled callbacks that were queued before `delete()` but have not yet fired are dropped at dispatch time via the per-scenario alive-gate on `scheduleScoped`. No further attach/ready/moved events have effect.

The production server starts scenarios immediately on creation (`DefaultScenarioOrchestration` calls `room.startScenario(id)` after adding). The run-scenario harness passes `autoStartScenario: false` so the scenario stays created-not-started while bots connect + auto-ready + the observer browser is prewarmed; once the observer signals ready, the harness calls `room.startScenario(id)` to replay the buffered lifecycle.

## Vote Region Tracking

After each tick's player movement, `onPlayerMoved` calls `regionAt(x, z)` which iterates active regions and returns the first whose Euclidean distance from the player is ≤ radius. If the result differs from the stored region, `playerRegions` is updated and `notifyVoteListeners` fires all registered callbacks whose watched set intersects the changed region ids.

## Geometry Visibility

On `onPlayerAttach`, each player receives the initial geometry state derived from `initialVisibility` (defaulting to visible for any geometry id not listed). The `geometry_state` message is sent immediately with every geometry id and its resolved initial visibility.

`ctx.setGeometryVisible(ids, visible, playerIds?)` updates `playerGeometry` for each target player and sends per-player `geometry_state` messages. If `playerIds` is omitted or empty, every attached player is targeted and the global visibility is updated, which also drives `checkWalkableVariants` and `checkToggleVariants`.

## Walkable Variants

`Scenario.checkWalkableVariants()` is called from `setGeometryVisible` whenever a global (all-player) visibility change occurs. It iterates `walkableVariants` in order and fires `deps.onWalkableUpdate(v.walkable)` for the first variant whose every trigger id is currently visible in `globalGeomVisible`. The deps closure (supplied by `MultiplayerRoom.buildScenario`) calls `world.setWalkable(area)` followed immediately by `world.snapAllPlayers()`. `snapAllPlayers` iterates every player and, for any whose current `(x, z)` is outside all new walkable rects, replaces their position with the nearest valid point (axis-aligned rect clamp). The corrected position is then sent to the affected client on the next `move_ack` cycle.

The client mirrors this in `Player.tsx`: when `store.activeWalkable` changes (set by `useWebSocket.ts` on `geometry_state`), `world.setWalkable` is called and `world.snapPlayer(playerId)` is called immediately after, preventing the local player from being frozen for the duration of the move-ack round trip.

## Re-entrancy Safety

`MultiplayerRoom.removePlayer` is safe to call from within a Scenario callback (e.g., from `ctx.eliminatePlayer`). The call stack is:

```
MultiplayerRoom.runTick
  → ScenarioManager.onPlayerMoved → Scenario.onPlayerMoved
    → notifyVoteListeners → script callback
      → ctx.eliminatePlayer → MultiplayerRoom.removePlayer
        → ScenarioManager.detachPlayer → Scenario.onPlayerDetach (clears per-player state)
        → players/world maps cleared, player_left broadcast
  ← returns to MultiplayerRoom.runTick; subsequent sendToPlayer for eliminated player is a no-op
```

`MultiplayerRoom.runTick` checks `this.players.has(playerId)` before calling `ScenarioManager.onPlayerMoved`, preventing a double-call if the player was eliminated in the NPC damage pass above.
