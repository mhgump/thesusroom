# Game Script — Implementation

## Relevant Files

```
server/src/
  GameSpec.ts            — Type definitions: InstructionEventSpec, VoteRegionSpec, GameSpec, validateGameSpec
  GameScript.ts          — Event types (ToggleVoteRegionOnEvent, ToggleVoteRegionOffEvent, InstructionEvent),
                           GameScriptContext interface, GameScript interface
  GameScriptManager.ts   — Runtime: vote region state, player tracking, listener dispatch, context factory
  scripts/
    DemoGameScript.ts    — Demo script implementing the voting game
  WorldManager.ts        — ServerWorldSpec extended with optional gameSpec and gameScript fields
  Room.ts                — Integrates GameScriptManager; calls onPlayerConnect, onPlayerDisconnect, onPlayerMoved
src/game/
  GameSpec.ts            — Client-side mirror of server/src/GameSpec.ts (type definitions only)
  DefaultGame.ts         — DEFAULT_GAME_SPEC: client-side vote region definitions for the demo world
src/network/
  useWebSocket.ts        — instruction message → store.showRule({ rules: [{ label: 'COMMAND', text }] })
```

## Architecture

`GameSpec` and the `GameScript` interface live in separate files from the manager so scripts can import only the interface they implement without pulling in runtime dependencies.

`GameScriptManager` owns:
- `activeRegions: Set<string>` — region ids currently enabled via `toggleVoteRegion`
- `playerRegions: Map<string, string | null>` — every connected player mapped to their current region id
- `voteListeners` array — registered `onVoteChanged` callbacks with their watched region id sets

`Room` creates a `GameScriptManager` in its constructor whenever `gameSpec` is provided. The manager receives two callbacks into Room: `sendInstruction` (sends an `{ type: 'instruction', text }` message to a specific player) and `removePlayer` (calls `Room.removePlayer`).

## Lifecycle Integration in Room

| Room event | GameScriptManager call |
|---|---|
| `addPlayer` | `onPlayerConnect(playerId)` — adds player to tracking, fires script callback |
| `removePlayer` | `onPlayerDisconnect(playerId)` — removes player from tracking before maps are cleared |
| `processMove` (after damage pass) | `onPlayerMoved(playerId)` — recomputes region, notifies listeners if changed |

`onPlayerMoved` is called only when `this.players.has(playerId)` is true, so it is skipped for players eliminated earlier in the same `processMove` call (e.g., by a damage event).

## Vote Region Tracking

After each `processMove`, `onPlayerMoved` calls `regionAt(x, z)` which iterates active regions and returns the first whose Euclidean distance from the player is ≤ radius. If the result differs from the stored region, `playerRegions` is updated and `notifyListeners` fires all registered callbacks whose watched set intersects the changed region ids.

## Re-entrancy Safety

`Room.removePlayer` is safe to call from within a `GameScriptManager` callback (e.g., from `ctx.eliminatePlayer`). The call stack is:

```
Room.processMove
  → GameScriptManager.onPlayerMoved
    → notifyListeners → DemoGameScript callback
      → ctx.eliminatePlayer → Room.removePlayer
        → GameScriptManager.onPlayerDisconnect (removes from playerRegions)
        → players/world maps cleared, player_left broadcast
  ← returns to Room.processMove; subsequent sendToPlayer for eliminated player is a no-op
```

`Room.processMove` checks `this.players.has(playerId)` before calling `onPlayerMoved`, preventing a double-call if the player was eliminated in the NPC damage pass above.
