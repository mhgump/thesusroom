# World / Scenario responsibility refactor — handoff

## The design thesis (user's framing — hold this as ground truth)

There are two top-level content specs: **MapSpec** (`content/maps/{id}/map.ts` → `GameMap`) and **ScenarioSpec** (`content/scenarios/{id}/scenario.ts`). Everything else the code calls a "spec" is a sub-field, not a peer.

The **map** configures all placed things: rooms, room connections, geometry, buttons, vote regions, instruction strings. Not all of these are physics primitives, but they are all map-authored data.

Given that, **runtime state for everything the map places should live in `World`**. World owns the live state (positions, occupancies, geometry visibility, room enabled/disabled, button states, vote region active flag) and exposes mutation APIs (add/remove map, enable/disable room, toggle geometry, configure button, toggle vote region active). World is also allowed to be extended: e.g. adding a new map onto existing rooms at runtime.

**Scenario** owns only script runtime state (the `S` object from `initialState()` plus the pending-registrations table). It does **not** own button state, vote region state, occupancy, or anything map-derived. It reaches map-primitive state by calling into World. It receives map-primitive *events* (button pressed/released, vote region entered/exited, player entered room, touched, damage) by subscribing to World.

If you find yourself duplicating a piece of state between Scenario and World, move it to World.

## What's already done (prior refactor — don't redo this)

A prior pass converted `GameScript` from a closure-heavy class to a pure state+handlers shape. Read these to understand the current surface:

- `react-three-capacitor/server/src/GameScript.ts` — `GameScript<S> { initialState; onPlayerConnect?; onPlayerReady?; handlers }`. All registrations are by handler id + serializable payload. `GameScriptContext` has `after(ms, handlerId, payload) → timerId`, `cancelAfter`, `off`, `onVoteChanged(regionIds, handlerId)`, `onPlayerEnterRoom(handlerId)`, `onButtonPress(buttonId, handlerId)`, `onButtonRelease(buttonId, handlerId)`, plus `terminate()` and `closeScenario()`.
- `react-three-capacitor/server/src/Scenario.ts` — now holds `scriptState` and five pending-registration tables (timers, voteListeners, roomEnterListeners, buttonPress/Release). `dumpState()` / `restoreState()` already round-trip that.
- `react-three-capacitor/src/game/World.ts` — already has `dumpState()` / `restoreState(dump, mapsByInstance)`. Round-trips geometry, connections, players, rules, touching pairs, per-player overrides, move queue.
- All 4 `content/scenarios/*/scenario.ts` + `assets/initial/scenario.ts` are migrated to the new shape. `ScenarioSpec.script` is a singleton (no `scriptFactory`), `ctx.terminate()` replaces the module-level `_terminateCb` pattern.
- `tools/src/_shared/validate.ts` checks for `script.initialState` not `scriptFactory`/`onTerminate`.

Pre-existing typecheck error in `content/maps/index.ts(39,33)` about `import.meta.glob` — **not yours to fix**, ignore it.

## What the refactor needs to do

### 1. Terminology / type cleanup (do this first — unblocks everything)

- `react-three-capacitor/src/game/GameSpec.ts` currently defines `GameSpec { instructionSpecs, voteRegions, buttons? }` and its comment even calls it "Per-scenario gameplay content" — that comment is wrong. It's map-sourced, attached to `GameMap.gameSpec`.
- `WorldSpec` in `react-three-capacitor/src/game/WorldSpec.ts` is the rooms + connections piece of the map.
- Decide: either fold `worldSpec` + `gameSpec` fields flat into `GameMap` (preferred), or rename `GameSpec` → something like `MapGameplayOverlay` and `WorldSpec` → `RoomTopology`. The flat fold is cleaner. Touch every consumer — there are callsites in `MapInstance.ts`, `CameraConstraint.ts`, scenarios, server Room, Scenario, validation, tools.
- After this pass, the word "spec" should only appear for `MapSpec` and `ScenarioSpec` at the top level; sub-fields on the map are not "specs."

### 2. Move button runtime state into World

- Delete `react-three-capacitor/server/src/ButtonManager.ts`. All of its state belongs on `World`:
  - `buttonConfigs: Map<buttonId, ButtonConfig>` — mutable (scenarios patch via `modifyButton`)
  - `buttonStates: Map<buttonId, ButtonState>` — 'idle' | 'pressed' | 'cooldown' | 'disabled'
  - `buttonOccupants: Map<buttonId, Set<playerId>>`
  - `buttonCooldownCancels: Map<buttonId, () => void>`
- Button specs are loaded when a map is added (`addMap(map)` reads the map's button list — see point 1 for where that ends up after the flat fold).
- World exposes: `setButtonConfig(id, changes)`, `setButtonState(id, state)`, `getButtonInitData()`, and internally re-evaluates press criteria when occupancy or config changes.
- World **emits events** for button transitions. Extend `WorldEvent` with `button_press { buttonId; occupants }` and `button_release { buttonId }`. Route them through the same per-tick `processTick()` result — do not create a parallel dispatch path.
- Cooldown timers currently use a caller-provided `scheduleSimMs`. Keep that dep (Room passes it in), but move it off ButtonManager onto World. World is already Room-provided-scheduler-less today — you'll need to either add a constructor arg or have the Room register the scheduler post-construction. Constructor arg is cleaner.

### 3. Move vote region runtime state into World

- Currently in `Scenario.ts`: `voteRegionSpecs`, `activeRegions`, `playerRegions`, `regionAt()`, `notifyVoteListeners`, `emitVoteAssignments`. All of these move to World.
- World owns: `voteRegions: Map<id, VoteRegionSpec>`, `activeVoteRegions: Set<id>`, `playerVoteRegion: Map<playerId, regionId | null>`.
- World API: `setVoteRegionActive(regionId, active)`, `getVoteAssignments()`.
- World emits `vote_region_change { assignments: Record<playerId, regionId | null> }` as a world event whenever a tracked player transitions in or out of an active region.
- The `vote_assignment_change` wire message currently broadcast by Scenario (`Scenario.ts emitVoteAssignments`) — move the broadcast trigger to where Scenario listens for World's `vote_region_change` event, or have the Room do it directly on receipt. Do not let two places broadcast it.

### 4. Room / room-visibility handling

Map authoring also configures rooms; their runtime state lives in World already (`roomBounds`, `connections`, `playerRoom`, `playerAccessibleRoomsOverride`). Two gaps today:

- **Per-player room visibility** (`playerRoomVisible`, `globalRoomVisible`) is currently in `Scenario.ts`. Move it to World and add `setRoomVisible(roomIds, visible, playerIds?)`. World emits `room_visibility_change` events when per-player state changes (so the Room can decide to forward a `room_visibility_state` message to that player).
- **Room enable/disable**: the user explicitly called out that World should be able to disable a room. Today there's no such API — `setConnectionEnabled` only toggles adjacency. Add `setRoomEnabled(scopedRoomId, enabled)` on World: a disabled room is removed from the `getAccessibleRooms` derivation, its geometry colliders are unregistered, and any players currently inside are evicted (or delegated to the caller by emitting a `room_disabled` event — pick one, document it).

### 5. Add-map-onto-existing-rooms

User called this out as a capability World should support. Today `addMap()` only creates new rooms from the map's WorldSpec; it doesn't attach map-authored overlays (buttons, vote regions, geometry) onto rooms contributed by a *previous* `addMap`. Depending on what the map author means by "existing room ids," you may need to:

- Allow a map to reference room ids from a previous map instance (scoped via `mapInstanceId`) and attach its geometry/buttons/voteRegions to those rooms without creating new rooms.
- Or split the method: `addMap(map)` for fresh-rooms, `addOverlay(overlay, targetRoomIds)` for attaching to existing ones.

Ask the user before implementing if the use case isn't obvious from existing code — this is the only piece that might need clarification.

### 6. Scenario becomes thinner

After the above, `Scenario.ts` should only own:
- `scriptState` + the five pending-registration tables (already there)
- The `onPlayerConnect` / `onPlayerReady` lifecycle replay on `start()`
- Subscription to World events (bridging World's typed events to the script's named handlers)
- Forwarding methods on `GameScriptContext` that proxy to World (`toggleVoteRegion`, `setGeometryVisible`, `setRoomVisible`, `modifyButton`, `setButtonState`, `setConnectionEnabled`, `setPlayerAllowedRooms`)
- Close/terminate callbacks (`deps.onClose`, `deps.onTerminate`)

The scenario should no longer directly hold: button state, vote region state, room visibility state, occupancy tracking of any kind.

`ButtonManager.ts` file should be deleted.

### 7. Dump/restore integration

- Extend `WorldDump` to cover buttons (configs + states + occupants + pending cooldown deadlines in terms of `fireAtTick`, same pattern as Scenario's timers), vote regions (active set + per-player assignments), and per-player room visibility. **Don't** dump the cooldown cancel functions — dump the deadline tick and re-arm via `scheduleSimMs` on restore, identical to how `Scenario.restoreState` re-arms timers.
- Add a `Room.dumpState()` that returns `{ world: WorldDump; scenarios: Record<scenarioId, ScenarioDump> }` and a matching `Room.restoreState()`. This is the public entry point for "dump a moment in time."
- Write a round-trip smoke test: build a room, run a few ticks through a scenario that uses buttons and vote regions, dump, restore into a fresh room, dump again, assert JSON equality. Use `/tmp/*.mts` + `npx tsx` — that's how the World dump test was validated.

## Concrete file list to edit

- `react-three-capacitor/src/game/GameSpec.ts` — rename or fold. Fix the misleading comment.
- `react-three-capacitor/src/game/WorldSpec.ts` — same.
- `react-three-capacitor/src/game/GameMap.ts` — flat fields (or updated references).
- `react-three-capacitor/src/game/World.ts` — gain button + vote region + room-visibility state, new APIs, new events, extended dump/restore.
- `react-three-capacitor/server/src/Scenario.ts` — strip out the moved state, rewire `ctx.*` methods to call World, subscribe to World events for press/release/vote-change/room-enter dispatch.
- `react-three-capacitor/server/src/ButtonManager.ts` — delete.
- `react-three-capacitor/server/src/Room.ts` — wire World's new constructor arg for scheduler; add `Room.dumpState()` / `Room.restoreState()`; forward World's broadcast-worthy events (vote_assignment_change, button_state, button_config, room_visibility_state) to the wire.
- `react-three-capacitor/server/src/GameScript.ts` — no signature changes should be needed; the handler-id registration API is already right. Only touch if you find a mismatch.
- `content/maps/*/map.ts`, `content/scenarios/*/scenario.ts`, `assets/initial/{map,scenario}.ts` — update if the flat-fold of GameSpec/WorldSpec changes their import shape.
- `tools/src/_shared/validate.ts` — update duck-type checks if map shape changes.
- `react-three-capacitor/server/scripts/run-scenario.ts` — no behavioral change expected, but verify it still runs end-to-end after the changes.

## Ground rules

- **Work file-by-file with typecheck passes between each major change.** `cd react-three-capacitor/server && npm run build` is the canonical check. One pre-existing error in `content/maps/index.ts` — ignore.
- **Do not reintroduce closures in scenarios.** The entire point of the prior refactor was that scenarios contain no closures, no instance fields, no module-level mutable state. If you find yourself adding any, you've gone off the rails.
- **Do not merge this refactor with the map-terminology rename into one commit.** Land the rename first in its own pass (it's mechanical), then the state migration. Two clean diffs > one tangled one.
- **Events, not callbacks.** Everything new in World should emit via the existing `WorldEvent` union, not via subscribe-a-closure APIs. Closures there would defeat dump/restore for the same reason they defeated it in Scenario.
- **Check round-trip at each milestone.** After buttons move: round-trip test with a scenario that presses a button. After vote regions move: test with a scenario that triggers vote-change. After room visibility: test with a per-player room-visibility change. Each of these is ~20 lines of `/tmp/*.mts`.
- **Deterministic timers.** Dumped cooldowns must re-fire on the same sim-tick post-restore. The `getSimMsPerTick` dep added to `ScenarioDeps` for this reason already exists — use the same pattern in World.
- **Ask before inventing API.** Specifically around multi-map layering (point 5) and what "disable a room" means for players currently inside it (point 4). Everything else follows from the thesis.

## Report at the end

One-paragraph summary of: (a) did the flat-fold rename happen; (b) list of files deleted, added, or substantially rewritten; (c) result of the round-trip smoke tests; (d) anything the user needs to decide about (open questions you couldn't resolve). Don't write a long markdown report — terse is fine.
