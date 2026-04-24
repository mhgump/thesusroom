# Fix room-toggle leaks (rendering + physics)

## Your task

Right now "room is toggled off" is only enforced at the client-side room-render gate. Two things leak through:

1. **Other players' avatars still render** for a viewing client even when those players are in a room that's toggled off for the viewer. You should hide the remote player's mesh if their current room is toggled off from the viewer's perspective.
2. **Both server and client physics still collide** with geometry that belongs to a toggled-off room. Colliders inside rooms that are toggled off for a player must be non-solid for that player — server-side movement and client-side character-controller physics.

Key invariant the user stated: **every room that overlaps the player's current room is guaranteed to be toggled off for that player.** "Toggled off" ≡ invisible AND non-collidable.

Use that invariant to your advantage — the overlap-set (already tracked in `buildMapInstanceArtifacts`) is the source of truth for which rooms need hiding/non-collision for a given viewer. You don't have to wire a new state channel; the data is already there.

---

## Project orientation

### Directory layout
- `content/maps/<scenario_id>/map.ts` — map spec (rooms, connections, geometry, vote regions, instruction specs)
- `content/scenarios/<scenario_id>/scenario.ts` — `ScenarioSpec` (script, hubConnection, exitConnection, initialVisibility, etc.)
- `content/scenarios/<scenario_id>/test_specs/<name>/spec.json` — test specs (bot lists, timeouts); the `run-scenario` harness reads these
- `content/bots/<scenario_id>/<bot_name>/bot.ts` — `BotSpec` implementations
- `content/scenario_runs/<scenario_id>/<test>/<index>/response.json` — recorded run logs/transcripts
- `assets/initial/map.ts` + `assets/initial/scenario.ts` — the shared hub hallway used by hub transfers
- `react-three-capacitor/src/game/*.ts` — shared client+server code (World, WorldSpec, MapInstance, RoomSpec, CameraConstraint, GameSpec)
- `react-three-capacitor/src/scene/*.tsx` — client rendering (GameScene, GeometryLayer, and where Player meshes live)
- `react-three-capacitor/src/network/*.ts` — client wire + position buffer
- `react-three-capacitor/server/src/*.ts` — server-only code (Room, Scenario, GameServer, orchestration, ContentRegistry, GameScript, exitTransfer)

### Key files you'll need
- `react-three-capacitor/src/game/World.ts` — **identical** to `react-three-capacitor/server/src/World.ts`. Canonical physics + Rapier wiring. Both copies must stay in sync when you change physics. Touch-pair detection, move processing, `resolveOverlap`, and the stay-in-rooms constraint live here. Lookups you care about: `roomBounds`, `overlappingRoomIds`, `globalRoomVisible`, `playerRoomVisible`, `geometryState`, `playerGeomOverride`, `playerAccessibleRoomsOverride`, `resolveCurrentRoom`, `isInRoomSet`. `setRoomVisible` is the current visibility API.
- `react-three-capacitor/src/game/MapInstance.ts` — `buildMapInstanceArtifacts` populates the `overlapSet` (pairs of rooms whose AABBs overlap in world space).
- `react-three-capacitor/src/game/WorldSpec.ts` — `validateWorldSpec` runs per map at load. It NO LONGER rejects overlapping rooms (that's intentional — scenario1 now has overlapping per-player sub-rooms). `roomsOverlap` is the raw AABB check.
- `react-three-capacitor/src/scene/GameScene.tsx` + `react-three-capacitor/src/scene/GeometryLayer.tsx` — current render gate: `if (world?.isRoomOverlapping(scopedId) && scopedId !== currentRoomId) return false`. This is ONLY the rendering gate. It doesn't touch Rapier colliders, and it doesn't gate remote-player meshes.
- `react-three-capacitor/server/src/Scenario.ts` — scenarios' server-side facade; `onPlayerMoved` tracks `playerCurrentRoom` and dispatches `onPlayerEnterRoom` / `onPlayerEnterScenario`.
- `react-three-capacitor/server/src/Room.ts` — `MultiplayerRoom`. `processTick` runs moves, broadcasts `player_update`, drains scheduled callbacks. `maybeReleaseHubTransfer` restores hub geometry after a player crosses into the scenario.

### Scenario framework in a nutshell
- `GameScript<S>` is the behaviour side (pure, no closures over instance data). State lives on `S`. Handlers fire via ids looked up in `script.handlers`.
- Hooks fired by the framework: `onPlayerConnect`, `onPlayerReady`, `onPlayerEnterScenario` (new — fires once per player the first time they cross into a room in `attachedRoomIds`). Plus registered handlers: `ctx.after`, `ctx.onVoteChanged`, `ctx.onPlayerEnterRoom`, `ctx.onButtonPress/Release`.
- `ctx.setGeometryVisible(ids, visible, playerIds?)` — per-player or global. Per-player overrides live in `playerGeomOverride` (a Map<geomId, boolean>). When the override toggles a piece ON, `resolveOverlap` runs to eject any overlapping player.
- `ctx.setRoomVisible(roomIds, visible, playerIds?)` — per-player or global. Per-player overrides live in `playerRoomVisible`. Sends a `room_visibility_change` wire event; the client stores them and the render gate consults them.
- Hub transfers: a player connects to `/` → solo hallway → `findOrCreateHubSlot` moves them into a scenario MR via `acceptHubTransfer`, which attaches the hallway map as an extra instance. Walls (`initial_wn` + the scenario's hub dock) drop and the cross-instance edge enables once the client acks `world_reset`.

### What I just did that's worth knowing
- Added `GameScript.onPlayerEnterScenario(state, ctx, playerId)` — the hook fires once per player on the first room-transition into an `attachedRoomIds` member, and is replayed on `Scenario.start()` for already-entered players.
- Rewrote `content/maps/scenario1/map.ts`: the main room shrank to 1.6 × 0.75 with four isolation cells, and four 0.5 × 0.5 sub-rooms (`p1..p4`) now hang off main's north wall. **Adjacent sub-rooms overlap by 0.1 in x.** The overlap is intentional — each sub-room is centered on its owner's vote box. Doors `s1_d1..s1_d4` in main's north wall start solid and drop per-player on vote success (see `scenario.ts`).
- Relaxed `validateWorldSpec` to allow overlapping rooms (the old unconditional throw was the only thing blocking scenario1's new layout). `overlapSet` in `buildMapInstanceArtifacts` already tracks the overlaps for you.
- Rewrote `content/maps/scenario4/map.ts`: removed `south_hall`, made `center` the hub entry room with a 3-segment south wall pattern (like scenario1/2/3). `scenario.ts` updated to `mainRoomId: 'center'`, `dockGeometryId: 's4_c_s'`. This fixed the "stuck in the south wall" bug that happened when the narrow 0.25-wide `south_hall` was the dock room and `maybeReleaseHubTransfer` restored the dock geometry while the player was still straddling it.

---

## Your two bugs

### Bug 1 — remote-player render leak

Right now when client A is in `main` and client B is in `p2` (a sub-room that overlaps `p1`/`p3`), A sees both the `p2` room geometry (correctly hidden by `isRoomOverlapping` gate) AND client B's avatar (NOT gated). That's because the scene renders remote player meshes without consulting the per-player room of the remote player.

Look at wherever the remote-player mesh components live in `react-three-capacitor/src/scene/` (search for how `player_update` events/`positionBuffer` feed a mesh). That component needs the same treatment as GeometryLayer: if the remote player's current scoped room overlaps the viewer's current room (i.e. is in `overlappingRoomIds` and `!==` the viewer's current), hide the mesh.

Note the server broadcasts each remote player's server-authoritative position via `player_update`. Whether the server also ships the remote player's `currentRoom` is something you'll need to check — it may not, in which case the client can resolve it from position via `world.resolveCurrentRoom(playerId)` or by looking up `world.playerRoom` (see `World.ts` `resolveCurrentRoom` / `playerRoom` fields). If the data isn't already there, thread it through the move messages rather than doing per-frame position→room lookups on the client.

### Bug 2 — physics collision leak

Rapier colliders are registered globally in `World.addMap` regardless of room visibility. The stay-in-rooms constraint in `World.processMove` uses `getAccessibleRooms(playerId)` to clamp post-move position, but the Rapier character controller itself sweeps against *every* collider. So if room `p2` (toggled off for a given player) contains geometry, the player's capsule will still bump into it.

Fix path:
- Server `World.processMove` already builds a `passableHandles` set that the character controller filter consults (the walk filter at ~`Line 862` excludes both the player's own collider and `passableHandles`). Extend the passable set to include all colliders that belong to a room that's toggled off for this player. The mapping is: `overlappingRoomIds` ∩ (rooms that aren't the player's current room) → their geometry handles. `FlattenedGeometry` from `buildMapInstanceArtifacts` knows which roomId each geom belongs to — you may need to surface that mapping (it's not currently stored per-geom in the World, but the data is at hand).
- Client `World.ts` is the same class; the same logic applies. Both copies must stay in sync (see the comment at the top of each file).
- For `setGeometryVisible(..., false)` to interop with this correctly, confirm that per-player geom overrides and per-player room overrides compose sensibly. Currently each is independent — `toggleGeometryOff(id, playerId)` flips a specific id, `setRoomVisible(ids, false, [pid])` flips rooms. Decide whose precedence wins at collision time and document it in `World.ts`.

### Useful invariant for both bugs
Per the user: "every room that overlaps the player's current room is guaranteed to be toggled off." That means you can derive the "toggled-off-for-player-X" room set as `overlappingRoomIds \ {playerCurrentRoom}` — no need to track per-player explicit toggles for this case. But `setRoomVisible(..., false, [pid])` can also toggle non-overlapping rooms off, so handle both sources.

---

## How to validate
- `cd react-three-capacitor/server && npx tsc --noEmit` — baseline has known errors in `content/bots/scenario2/stayer/bot.ts` (not yours to fix); anything else is you.
- `cd react-three-capacitor && npx tsc --noEmit` — should be clean.
- Run scenario1 manually (`/scenarios/scenario1`) with 4 clients to test sub-room per-player visibility + physics isolation.
- For automated tests, there's a `run-scenario` CLI harness driven by `content/scenarios/<id>/test_specs/<name>/spec.json`; recordings land under `content/scenario_runs/`.

## Don'ts
- Don't re-introduce the overlapping-room rejection in `validateWorldSpec` — scenario1's sub-rooms depend on overlap being allowed.
- Don't drift the two `World.ts` copies — update both identically.
- The `playerCurrentRoom` the Scenario tracks and the `playerRoom` the World tracks are kept in sync via `setPlayerRoom` in `Scenario.onPlayerMoved`. Prefer reading from `world.playerRoom` / `world.resolveCurrentRoom` rather than cascading through Scenario.
- Don't touch the `validateWorldSpec` connection/geometry checks — those are unrelated and still needed.
