# Game Script — Implementation

## Relevant Files

```
react-three-capacitor/server/src/
  GameSpec.ts            — Type definitions: InstructionEventSpec, VoteRegionSpec, FloorGeometrySpec, GameSpec, validateGameSpec
  GameScript.ts          — Event types (ToggleVoteRegionOnEvent, ToggleVoteRegionOffEvent, InstructionEvent),
                           GameScriptContext interface (including closeScenario, setGeometryVisible, getVoteAssignments),
                           GameScript interface
  GameScriptManager.ts   — Runtime: vote region state, player tracking, per-player geometry visibility,
                           listener dispatch, context factory
  ScenarioRegistry.ts    — MapSpec and ScenarioSpec interfaces; creates Room instances on demand via scriptFactory
  Room.ts                — Integrates GameScriptManager; calls onPlayerConnect, onPlayerDisconnect, onPlayerMoved
react-three-capacitor/src/game/
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
  useWebSocket.ts        — instruction message → store.showRule({ rules: [{ label: 'COMMAND', text }] })
```

## Architecture

`GameSpec` and the `GameScript` interface live in separate files from the manager so scripts can import only the interface they implement without pulling in runtime dependencies.

`ScenarioSpec` uses a `scriptFactory: () => GameScript` function rather than a single script instance. `ScenarioRegistry.getOrCreateRoom` calls `scenario.scriptFactory()` each time a new `Room` is created, ensuring every room gets a fresh script with no stale state from prior rooms.

`GameScriptManager` owns:
- `activeRegions: Set<string>` — region ids currently enabled via `toggleVoteRegion`
- `playerRegions: Map<string, string | null>` — every connected player mapped to their current region id
- `playerGeometry: Map<string, Record<string, boolean>>` — per-player geometry visibility state (player id → geometry id → visible)
- `globalGeomVisible: Map<string, boolean>` — global (all-player) visibility state used to evaluate walkable variants
- `walkableVariants: Array<{ triggerIds: Set<string>; walkable: WalkableArea }>` — ordered list of variants; first fully-triggered variant wins
- `voteListeners` array — registered `onVoteChanged` callbacks with their watched region id sets

`Room` creates a `GameScriptManager` in its constructor whenever `gameSpec` is provided. The manager receives four callbacks into Room: `sendInstruction` (sends an `{ type: 'instruction', text }` message to a specific player), `removePlayer` (calls `Room.removePlayer`), `onCloseScenario` (supplied by `ScenarioRegistry` to remove the room from the open registry), and `sendGeometryState` (sends a `{ type: 'geometry_state', updates }` message to a specific player).

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
