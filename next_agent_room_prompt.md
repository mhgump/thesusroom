# Next Agent: Room Subsystem Refactor

You are refactoring the server-side `Room` abstraction in this repo. The current `Room` class conflates four concerns: a WebSocket multiplayer session, a physics world, scenario-script lifecycle, and NPC management. This briefing hands off everything the previous agent (me) learned while adding tick-rate configurability, a client-ready protocol, and a deferred-scenario-start mode — and then asks you to perform a cleaner structural split so those features sit on cleaner seams.

Read this entire document before editing code. Read the three-way docs (`spec/`, `assumptions/`, `implementation/`) for `server-client`, `game_script`, `npc`, `bot`, `ux` to see the current contract surface.

---

## The refactor target

Introduce four explicit responsibilities, replacing today's monolithic `Room`:

### `World` (lives in `src/game/World.ts`, already shared client/server)

- Owns the physics simulation (already does).
- Exposes `addMap(mapSpec) → mapInstance` as the **only** public path to register map content. The existing `addMapInstance` path becomes an internal helper or is absorbed.
- Owns the set of **map instances**, and for each map instance, the set of inner-world **rooms** (`room1`, `room2`, `room3` in the demo — these are *spaces within the map*, not to be confused with the outer `MultiplayerRoom`).
- Inner-world rooms can be added, mutated (visibility, walkable overrides, adjacency), and deleted independently of the originating map spec. **The map spec is just the starting point** — once loaded, the World owns the live room state.
- Keeps physics `dt` fixed at 50 ms of sim-time per tick (1/`TICK_RATE_HZ`) regardless of any wall-clock rate choice above it. This invariant is load-bearing — do not parameterize it.

### `MultiplayerRoom` (replaces today's `server/src/Room.ts`)

- Owns one `World` instance.
- Owns one `ScenarioManager`.
- Drives the tick loop (drift-corrected self-rescheduling `setTimeout`, configurable wall-clock rate). The tick loop is the only thing advancing the World and the ScenarioManager's scheduled callbacks.
- Owns the player registry (id → WebSocket + colour + index), the `pendingMoves` buffer, and all player-facing I/O (`welcome`, `move_ack`, `player_update`, `instruction`, etc.).
- Exposes `connectPlayer(ws) → playerId` — the routing/orchestration layer calls this. It attaches the new player to the room's **default open scenario**. The routing framework should not reach past this method.
- Exposes `startScenario(scenarioId)` and `deleteScenario(scenarioId)`. **Pause is not a thing** — a scenario is either created (added, not yet started), started, or deleted. Once deleted, all its callbacks stop firing and the object is dropped.
- Handles the `{ type: 'ready' }` client message: records the ready in an insertion-ordered set on the room, then forwards to the appropriate scenario via the ScenarioManager.

### `ScenarioManager`

- Holds a `Map<scenarioId, Scenario>`.
- Is always owned by exactly one `MultiplayerRoom`. The `MultiplayerRoom` is responsible for **constructing** each `Scenario` (via `ScenarioSpec.scriptFactory()` plus the World and attached-rooms context) and for calling `manager.add(scenario)` / `manager.start(id)` / `manager.delete(id)`.
- Designates one scenario as the "default open scenario" — this is the one `connectPlayer` auto-attaches to. The manager exposes `getDefaultOpenScenario()`.
- Routes per-player events (`onPlayerConnect`, `onPlayerReady`, `onPlayerMoved`, `onPlayerDisconnect`) to the correct scenario based on which scenario the player is attached to.
- Drives scheduled callbacks: each scenario's `ctx.after` goes through `MultiplayerRoom.scheduleSimMs`, which is drained at the end of each tick.

### `Scenario` (one instance per attached scenario)

- Constructed with: a reference to the `World`, the set of attached inner-world rooms (subset of `World`'s rooms for one of its map instances), and the user-supplied `GameScript` from the `ScenarioSpec.scriptFactory()`.
- Validates at construction that every `ScenarioSpec.requiredRoomIds` is present in the attached rooms set. Failure is a throw.
- Has two states: **created-not-started** and **started**. Transition is one-way (`start()`). Deletion terminates the scenario regardless of state.
- While created-not-started, script callbacks do not fire. Player connects + ready signals are buffered on the Scenario. On `start()`, the Scenario replays `onPlayerConnect` for every attached player in connect-order, then `onPlayerReady` for every ready player in ready-order.
- Scenario-spawned bots (via `ctx.spawnBot`) and NPCs (if the scenario owns any) are the scenario's internal responsibility. They go through the same `connectPlayer` path as external players, but are attached to this scenario at spawn time (not via the default-open-scenario rule).
- Owns its slice of the world mutation surface: `ctx.setGeometryVisible`, `ctx.setRoomVisible`, `ctx.setWalkable`, etc. all operate through the scoped World API for *this scenario's attached rooms only*. A scenario must not be able to toggle geometry belonging to rooms outside its attachment set.

---

## Current state (read this before changing things)

### File map

```
react-three-capacitor/server/src/
  Room.ts                     — TO BE SPLIT INTO MultiplayerRoom + ScenarioManager + Scenario
  GameScriptManager.ts        — much of this becomes `Scenario`; the per-player bookkeeping
                                 (playerRegions, playerGeometry, playerRoomVisible) is scenario-scoped
                                 and should move with it
  GameScript.ts               — interface (stays, but ScenarioSpec/orchestration APIs will shift)
  GameSpec.ts                 — map-level static data (stays)
  ButtonManager.ts            — per-scenario state today; stays scenario-scoped (owned by `Scenario`)
  npc/NpcManager.ts           — currently per-room; in the new model NPCs are a World concern if
                                 they persist across scenarios, or a Scenario concern if bound to one.
                                 The demo map defines NPCs at the map level — they should live on
                                 the World (or the map instance on the World), not on a Scenario.
  ContentRegistry.ts          — static catalogue (stays)
  RoomRouter.ts               — routing layer (stays; but its room type changes to MultiplayerRoom)
  orchestration/
    DefaultScenarioOrchestration.ts — this file should shrink significantly.
                                      All it does in the new model: create MultiplayerRoom,
                                      addMap, create + add + start a single scenario. The
                                      "one scenario per room" policy remains default.
    RoomOrchestration.ts / resolvers.ts — interfaces mostly stay
  GameServer.ts               — WS accept, routes to RoomRouter.routePlayer → MultiplayerRoom.connectPlayer
  bot/BotClient.ts            — unchanged by this refactor (just the WS it connects to is still an MR)
  bot/BotManager.ts           — unchanged

react-three-capacitor/src/game/World.ts
  — shared, re-exported by server/src/World.ts. Physics + map instances + inner-world rooms.
    This is where the new World.addMap() lives.

react-three-capacitor/server/scripts/run-scenario.ts
  — test harness. Will use the new surface directly (see "run-scenario flow" below).
```

### What the previous agent (me) just changed — understand this before touching it

These changes happened in the last few hours. The *feature set* they delivered must survive the refactor; the *implementation seams* are what you're reshaping.

1. **Configurable wall-clock tick rate**. `Room` takes a `tickRateHz` option (default 20, run-scenario defaults 240). Physics sim-time per tick stays at 50 ms regardless. The tick loop is a drift-corrected self-rescheduling `setTimeout` chain (not `setInterval`) keyed on `performance.now()`. **Keep the drift-corrected loop** — at 240 Hz, `setInterval`'s 1 ms jitter-per-tick floor accumulates visibly. This belongs on `MultiplayerRoom`.

2. **Tick-based scheduler**. `Room.scheduleSimMs(ms, cb): () => void` converts `ms → ticks (ceil(ms/50))` and fires on the matching tick, drained at the end of `runTick`. **Every** in-game timer goes through this: `GameScriptManager.ctx.after`, `ButtonManager.startCooldown`, `NpcManager` periodic triggers. There are no remaining `setTimeout`/`setInterval` calls in the server core's simulation path. Audit this in the refactor — if you introduce a new timer, route it through `MultiplayerRoom.scheduleSimMs`, never through `setTimeout`.

3. **Welcome message carries `tickRateHz`**. Client's `positionBuffer.advanceRenderTick` uses it in place of the constant so remote interpolation keeps pace when the server runs faster. Don't break this — the welcome message shape is a contract between `server/src/types.ts` and `src/network/types.ts` (two independently maintained files that must stay in sync).

4. **Client-ready protocol**. `{ type: 'ready' }` is a `ClientMessage`. Both player and observer WS connections handle it. Player readies route to `Room.handlePlayerReady(playerId)` (will become `MultiplayerRoom.handlePlayerReady` and forward to the scenario). Observer readies fan out via `GameServer.onObserverReady(cb) → unsubscribe`. Used by run-scenario to gate recording on the browser having finished loading.

5. **Deferred scenario start (the one you're replacing with proper scenario lifecycle)**. Today: `Room` has a `deferScenarioStart` option; when true, `GameScriptManager.scenarioStarted = false` which suppresses the script's `onPlayerConnect`/`onPlayerReady` while letting map/geometry/button bookkeeping run. `Room.startScenario()` flips the flag and replays. **In the new model this becomes the natural "Scenario has been added but not yet started" state — the user is explicit that pause is not a scenario state, so a scenario being "in created state" is the replacement.** Do not carry the `deferScenarioStart` option forward. Instead, `MultiplayerRoom` always creates and adds the default scenario at construction (or the orchestration does), but `scenario.start()` is a separate call. For the production `DefaultScenarioOrchestration`, start is called immediately on creation. For run-scenario, it's called after the observer is ready.

6. **Bot client changes**. `BotClient` takes `{ tickMs, autoReady }` options. `dt` sent in each move input is fixed at `DEFAULT_TICK_MS / 1000 = 0.05` (sim-seconds per input), never wall-clock. `sendReady()` is a public method. Don't touch these — they live at the bot layer, below the Room refactor.

7. **Demo scenario gates on all-ready**. `content/scenarios/demo.ts` now tracks `readyPlayers: Set<string>` and opens the door in `onPlayerReady`, not `onPlayerConnect`. `onPlayerConnect` only starts the bot-fill timer. Scenario timeout is 90 s sim (scales to 7.5 s wall at 240 Hz). The demo uses `ctx.after` with sim-ms delays: bot-fill 2000ms (40 ticks), move-warn 2000ms (40 ticks), elim 4000ms (80 ticks), fact 1000ms (20 ticks). These are the canonical values — don't change them.

8. **run-scenario harness**. Uses `deferScenarioStart: true` today. It sets up the server, connects bots (they auto-ready on welcome, accumulate in the room's `readyPlayerIds` set), goes to the observer URL in headless Chromium, waits for `observer_ready_fired` via `onObserverReady`, starts the CDP screencast piped to `ffmpeg` (no `setpts` — natural frame rate), then calls `room.startScenario()`. Result: scenario plays on a recording observer. In the new model, substitute `room.startScenario('demo')` for the current mechanism.

### Things that must not regress

- Physics determinism. Sim dt stays 50 ms per tick.
- `handleMove` still never drops a move; they're sorted by `clientTick` on the next tick and flattened.
- `move_ack` / `player_update` fan-out rules (per-player touch filtering; events attach to the last ack in a batch only).
- The welcome → `tickRateHz` → client buffer flow.
- The `ready` → scenario-script → `onPlayerReady` flow.
- Observer URL resolution: `/observe/{key}/{i}/{j}` — `{i}` into the per-key all-rooms list, `{j}` a player index.
- Scenarios can still `closeScenario()` → room leaves the open list. Last player disconnect → room destroyed → slot freed.
- `DefaultScenarioOrchestration`'s "one scenario per room" policy is preserved as the default. The `ScenarioManager` supports multiple, but `DefaultScenarioOrchestration` only uses one.

---

## Migration plan (suggested order)

Do these in order. Each step ends with `cd react-three-capacitor/server && npm run build` passing, and (after step 5) a successful `npx tsx tools/scripts/run-test-spec.ts demo_success_test` producing a non-static video.

### Step 1 — Introduce `World.addMap(mapSpec)` without removing `addMapInstance`

- Add the method. Have it wrap `buildMapInstanceArtifacts` internally and call the existing `addMapInstance`. Return the created map instance.
- Surface inner-world rooms as a query on the World: `World.getRoomsInMapInstance(mapInstanceId)` returns the scoped room ids.
- No callers migrated yet.

### Step 2 — Extract `Scenario` class from `GameScriptManager`

- Keep `GameScriptManager` for now as a thin wrapper that delegates.
- New `Scenario` class owns: the `GameScript` instance, its `GameScriptContext`, per-attached-player bookkeeping (`playerRegions`, `playerGeometry`, `playerRoomVisible`), button state, vote listeners, room-enter listeners.
- `Scenario` lifecycle: `constructor(world, attachedRoomIds, spec, deps)`, `start()`, `delete()`, `onPlayerAttach(playerId)`, `onPlayerReady(playerId)`, `onPlayerDetach(playerId)`, `onPlayerMoved(playerId)`.
- `requiredRoomIds` check moves into `Scenario` constructor.
- The `scenarioStarted` gate I added becomes the natural "start() hasn't been called yet" state. `onPlayerAttach` / `onPlayerReady` buffer into per-scenario sets until `start()`; `start()` replays in order.

### Step 3 — Introduce `ScenarioManager`

- Owns `Map<scenarioId, Scenario>`, designates `defaultOpenScenarioId`.
- Methods: `add(scenario)`, `start(id)`, `delete(id)`, `getDefaultOpen()`, `forPlayer(playerId)`, `attachPlayerToDefault(playerId)`, `attachPlayerTo(playerId, scenarioId)`, `detachPlayer(playerId)`.
- Tracks which scenario each player is attached to.
- On delete: iterates the scenario's attached players, detaches each, calls `scenario.delete()`. Any scheduled callbacks owned by that scenario must stop firing — either track them per-scenario in the scheduler or gate on a per-scenario `alive` flag checked at dispatch time.

### Step 4 — Rename `Room` → `MultiplayerRoom`, plug in ScenarioManager

- Update all imports. The file can stay at `server/src/Room.ts` if you prefer minimal churn, but the class is `MultiplayerRoom`.
- `MultiplayerRoom.connectPlayer(ws) → playerId` absorbs the current `addPlayer` logic + calls `scenarioManager.attachPlayerToDefault(playerId)`.
- `handlePlayerReady(playerId)` delegates to `scenarioManager.forPlayer(playerId)?.onPlayerReady(playerId)` and records in the room-level ready set.
- `MultiplayerRoom.startScenario(id)` delegates to `scenarioManager.start(id)`. `deleteScenario(id)` delegates to `delete(id)`.
- Delete the `deferScenarioStart` option. The orchestration (or run-scenario) chooses when to call `startScenario`.
- Keep the tick loop, `scheduleSimMs`, move buffering, player I/O on `MultiplayerRoom` — these are not scenario-scoped.

### Step 5 — Simplify `DefaultScenarioOrchestration`

- `createRoom(ctx)`: construct `MultiplayerRoom(options)`, call `world.addMap(mapSpec)`, construct the scenario, `manager.add(scenario)`, `room.startScenario(scenario.id)` (since prod starts immediately), return the room.
- `onPlayerArrive` still calls `room.connectPlayer(ws)`, unchanged shape.
- `isOpen` still calls `room.isOpen()`.
- The "paused until explicit start" machinery moves out of here — prod orchestration just calls `startScenario` right away.

### Step 6 — Update run-scenario

- Replace `deferScenarioStart: true` option with: construct server normally, but have the orchestration construct the scenario **without** auto-starting it (need a way for run-scenario to request this — either an orchestration option `autoStartScenario: false` or have run-scenario use a different orchestration path).
- After observer ready + screencast started: `room.startScenario(scenarioId)`.
- Bots still auto-ready (default `autoReady: true` on BotClient); their readies buffer inside the Scenario until `start()` replays them.

### Step 7 — NPC lifecycle

- NPCs are declared on the map (`map.npcs`). They exist regardless of scenario. Move NPC ownership from today's `Room.npcManager` to `World` (or to the map-instance object inside `World`). Spawn happens at `world.addMap()` time.
- Periodic triggers still go through `MultiplayerRoom.scheduleSimMs` (the room owns the tick loop).
- Scenario-spawned NPCs, if any are ever introduced, would be scoped to the scenario's attached rooms — but no scenario today spawns NPCs, only bots. Leave the extensibility path open but don't implement it speculatively.

### Step 8 — Update the three-way docs

Update in place; don't create new files. The component boundaries don't change but the internals documented under `implementation/server-client.md` and `implementation/game_script.md` do. Specifically:

- `implementation/server-client.md`: replace the "Room" section with MultiplayerRoom / ScenarioManager / Scenario. Update the file map. Remove references to `deferScenarioStart` and `GameScriptManager.scenarioStarted`.
- `implementation/game_script.md`: reframe around `Scenario` (not `GameScriptManager`).
- `assumptions/server-client.md`: the `fireScenarioStart` bullet gets rewritten as "Scenario lifecycle: created → started → deleted; start replays buffered connects/readies."
- `assumptions/game_script.md`: update the "fresh script per room" bullet — now it's "fresh scenario per `ScenarioManager.add`".
- `spec/`: mostly unchanged; the behavioural contract is the same.

---

## Invariants and gotchas the previous agent learned the hard way

- **Bot `dt` is fixed 0.05, not wall-clock.** This was a real bug at 240 Hz: bots sent `dt=0.004` per input (wall-clock-derived), advanced in sim at 1/12 speed, got eliminated before reaching room 2. The fix is non-negotiable — *any* input where dt is wall-clock will desync sim-space motion at accelerated tick rates.
- **Observer URL 404s if no player exists.** `/observe/r_demo/0/0` returns 404 until a player with index 0 is in room 0. Don't load the observer before any bots connect — it'll hit the 404 route and stay stuck on that page. In practice this means: connect bots → prewarm observer page → wait for observer ready → start scenario.
- **`BotClient` default `autoReady` must stay `true`.** Bots have no loading screen, and scenario-spawned bots need to ready automatically. Run-scenario no longer needs `autoReady: false` — the scenario not-yet-started state buffers their readies.
- **The 250 ms client position buffer scales in *wall* time with the server tick rate.** At 240 Hz, 5 ticks = 21 ms wall. That's fine because jitter at high tick rates is lower in wall-clock terms. Do not change `BUFFER_TICKS`.
- **`welcome.tickRateHz` is what drives client-side `advanceRenderTick`'s speed**, not the hardcoded `TICK_RATE_HZ`. If a scenario ever dynamically changes tick rate mid-session (hypothetical), the welcome-once model would need a broadcast update. Don't build that until it's asked for.
- **`world.processTick()` is parameterless** — it uses the fixed canonical sim dt internally. Do not try to pass `dt` in; the fixed rate is the point.
- **Two copies of `ClientMessage`/`ServerMessage` types.** `react-three-capacitor/server/src/types.ts` and `react-three-capacitor/src/network/types.ts`. They're maintained independently and must stay in sync — a `ready` variant added to one and not the other is silently broken at runtime. When you change the wire protocol, touch both.
- **`GameScriptManager.onPlayerConnect` does bookkeeping *and* fires script callback.** If you split it, make sure the bookkeeping (geometry init, room visibility init, button init) still runs eagerly on connect, only the script callback is deferred.
- **`Room.players` is a `Map` with insertion order**. Relied on for replay order in `startScenario`. `ScenarioManager`'s ready-set replay also uses insertion order from the `Set`. Both JS semantics are stable — don't switch to plain objects.
- **Scenario `timeoutMs` is sim-ms**, not wall-ms. Default 90 000. Harness divides by `TICK_RATE_HZ / 20` to get a wall-clock setTimeout.
- **`closeScenario()` semantics**: router removes the room from the open list, room stays alive for currently-connected players until the last one leaves. In the new model, this becomes a scenario-level signal (the scenario is closed, no new attachments); the room itself stays alive until the ScenarioManager has no live scenarios AND no attached players. Decide explicitly how `closeScenario` and `deleteScenario` relate — probably closeScenario = "remove from default-open slot", deleteScenario = "tear down completely."

---

## Verification

After the refactor:

1. `cd react-three-capacitor/server && npm run build` passes.
2. `cd react-three-capacitor && npx tsc --noEmit` passes.
3. `cd react-three-capacitor && npm run build` produces a working frontend bundle.
4. `npx tsx tools/scripts/run-test-spec.ts demo_success_test` returns `complete: true`, `survivors: 2` (or 0 — the demo's elimination behavior depends on bot timing; what matters is that the video at `data/scenario_runs/<uuid>/0.mp4` is not a frozen loading screen and not a "not found" page, and has ~3–5 seconds of actual gameplay).
5. Start the dev server normally (`cd react-three-capacitor/server && npm run dev` alongside the client) and confirm a browser connecting to `http://localhost:{PORT}` lands in `r_demo` and plays the demo scenario end-to-end at 20 Hz with real human input.

If (4) or (5) regresses, you've broken an invariant — do not merge.

---

## Things out of scope

- Do not touch `positionBuffer.ts`, `WebSocketClient.ts`, or any client scene rendering.
- Do not touch `BotClient.ts`, `BotManager.ts`, or `BotTypes.ts`.
- Do not change the wire protocol (`ServerMessage` / `ClientMessage`). If you're about to, stop and re-scope — almost certainly the refactor doesn't require it.
- Do not add paused/resumed scenario states. User has been explicit: created, started, deleted.
- Do not introduce multi-scenario support in `DefaultScenarioOrchestration`. The ScenarioManager supports many; the default orchestration ships one. Extensibility is fine; speculative multi-scenario orchestrations are not.

Good luck. When in doubt, read what's there and ask before restructuring — the current code has been through several rounds of small fixes, and the invariants listed above each exist because something broke without them.
