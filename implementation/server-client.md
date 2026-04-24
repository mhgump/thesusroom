# Server–Client Protocol — Implementation

## Relevant Files

```
src/game/
  World.ts               — Shared physics (server re-exports from this file); exports TICK_RATE_HZ; touched disabled on client World instances via constructor arg; owns map instances and inner-world rooms via addMap() / addMapInstance() / getRoomsInMapInstance()
src/network/
  positionBuffer.ts      — server_world_tick tracking, render-tick pointer + variable-rate catch-up, position snapshots, event queues, move_ack queue
  useWebSocket.ts        — WebSocket message routing to store and positionBuffer; derives WS URL from page path
  types.ts               — ClientMessage / ServerMessage types (mirrors server/src/types.ts)
src/scene/
  Player.tsx             — Local player: prediction, correction, per-clientTick input history, 20 Hz move dispatch
  RemotePlayers.tsx      — Remote player meshes: render-tick-interpolated positions and events
  GameScene.tsx          — Drives advanceRenderTick once per frame at useFrame priority −3
src/store/
  gameStore.ts           — Player list, connection state (UI-only state; no position/event buffers)
server/src/
  World.ts               — One-line re-export of ../../src/game/World.js; server instances are created with no events disabled, so touched/damage/animation all fire
  Room.ts                — `MultiplayerRoom` class: configurable wall-clock tick loop (drift-corrected setTimeout chain), move buffering, sort-by-clientTick, player connect/disconnect, NPC management, tick-based `scheduleSimMs` queue, observer registration. Owns one World and one ScenarioManager; `connectPlayer(ws)` is the single entry point from the router; `startScenario(id)` / `deleteScenario(id)` delegate to the manager; `addMap(map)` spawns NPCs and registers the map's scoped rooms on the world; `buildScenario` constructs a Scenario wired to the room's broadcast/send channels
  Scenario.ts            — `Scenario` class: owns a GameScript + its GameScriptContext, per-attached-player bookkeeping (playerRegions, playerGeometry, playerRoomVisible, playerCurrentRoom), a ButtonManager, vote-region listeners, room-enter listeners, walkable/toggle variants. Lifecycle: created (via constructor) → started (via start()) → deleted (via delete()). Created-not-started scenarios buffer attach/ready events; start() replays them in arrival order. Scheduled callbacks routed through an alive-gate so post-delete dispatches are dropped
  ScenarioManager.ts     — `ScenarioManager` class: owns `Map<scenarioId, Scenario>`, tracks which scenario each attached player is on, designates a single `defaultOpenScenarioId` that new connections auto-attach to. Methods: add / start / delete / getDefaultOpen / closeDefaultOpen / forPlayer / attachPlayerToDefault / attachPlayerTo / detachPlayer / onPlayerMoved / destroyAll
  GameServer.ts          — WebSocket server; parses `r_{scenario}` from the URL path (non-observer) and `/observe/{key}/{i}/{j}` (observer); delegates to RoomRouter; instantiates ContentRegistry + the default resolver; handles `{type:'ready'}` from player and observer connections (observer readies fan out to `observerReadyListeners`); constructor accepts `{ tickRateHz, autoStartScenario }` threaded into the resolver
  ContentRegistry.ts     — Static catalogue of shipped `{map, scenario}` entries keyed by scenario id. Pure lookup; owns no runtime state
  RoomRouter.ts          — Per-routing-key open-room list and all-rooms slot index. Resolves routing keys to orchestrations, creates/picks rooms, maintains lifecycle callbacks. `routePlayer(key, ws)` returns `{ room, playerId }` — the room's `connectPlayer(ws)` allocates the id
  orchestration/
    RoomOrchestration.ts — Interface: `createRoom(ctx)`, `isOpen(room)`. `OrchestrationContext` carries the routing key, instance index, and close/destroy callbacks. Player-arrival is handled directly by `MultiplayerRoom.connectPlayer(ws)` through the router
    DefaultScenarioOrchestration.ts — Ports the original single-map single-scenario policy: constructs a MultiplayerRoom, calls `room.addMap(map)`, builds a Scenario via `room.buildScenario` with the map's GameSpec + scenario's initial state + walkable/toggle variants, adds it as the room's default-open scenario, and starts it immediately (unless `autoStartScenario: false`, used by the run-scenario harness)
    resolvers.ts         — `createDefaultScenarioResolver(content, spawnBotFn, options?)` → a `RoutingResolver` that parses `r_{scenario}` keys and returns a default orchestration for the matching scenario
  types.ts               — ServerMessage / ClientMessage types (server-side copy; kept in sync with src/network/types.ts)
```

## Shared World

There is a single `World` implementation at `src/game/World.ts`. The server's `server/src/World.ts` is a one-line `export * from '../../src/game/World.js'` that resolves to the same module at runtime, so client and server share bytes-on-disk identity rather than two maintained copies. `World` stores players in a `Map<string, WorldPlayerState>`. `processMove(playerId, jx, jz, dt)` mutates the player in-place and returns `WorldEvent[]`. `queueMove(playerId, inputs)` stores an ordered array of `{jx, jz, dt}` for the next tick. `processTick()` drains the queue, applies every queued input in order via `processMove`, and returns per-player events. The constructor accepts a string array of event types to disable; `'touched'` is disabled on all client instances. `TICK_RATE_HZ = 20` is the single source of truth for the 50 ms tick period on both sides.

`World.addMap(gameMap)` is the preferred entry point for registering a map: it calls `buildMapInstanceArtifacts(worldSpec, mapInstanceId)` internally and registers the resulting `WorldMapInstance` (scoped room ids + default adjacency) on the world. The lower-level `addMapInstance(instance)` remains for callers that already have the artifacts pre-built. `World.getRoomsInMapInstance(mapInstanceId)` returns the scoped room ids contributed by the named map instance. NPC spawning is owned by the enclosing `MultiplayerRoom.addMap`, which invokes `world.addMap(gameMap)` and then `npcManager.spawnAll(gameMap.npcs)` — NPCs live at the map level, not the scenario level, and persist across scenario lifecycle transitions.

## Server routing and orchestration (`GameServer.ts`, `RoomRouter.ts`, `ContentRegistry.ts`, `orchestration/`)

Routing and room lifecycle are split into three layers:

- **Content** (`ContentRegistry.ts`) — a static `{scenario id → {map, scenario}}` lookup built from the imports in `GameServer.ts`. No runtime state.
- **Orchestration** (`orchestration/`) — a pluggable policy (`RoomOrchestration`) deciding how a room is assembled, which scenarios it hosts, and when it closes/destroys. `OrchestrationContext` is how the orchestration signals lifecycle back to the router (close → drop from open list, destroy → free slot). The current deployment ships exactly one mode: `DefaultScenarioOrchestration`, which constructs a `MultiplayerRoom`, calls `room.addMap(map)`, builds a `Scenario` via `room.buildScenario(attachedRoomIds, config)` with the scenario's `requiredRoomIds` assertion performed inside the `Scenario` constructor, adds the scenario to the manager as the default-open scenario, and (unless `autoStartScenario: false`) calls `room.startScenario(id)`.
- **Routing** (`RoomRouter.ts`) — owns two per-key maps: `openRooms: Map<routingKey, MultiplayerRoom[]>` and `allRooms: Map<routingKey, (MultiplayerRoom | null)[]>`. `routePlayer(key, ws)` resolves the key to an orchestration (caching the instance), picks a random open room (pruning any that report `isOpen === false`), creates one via `orchestration.createRoom(ctx)` when none exist, calls `room.connectPlayer(ws)` to register the player and auto-attach them to the default-open scenario, and returns `{ room, playerId }`. `prewarm(key)` pre-creates a room at startup (`r_demo` in the shipped server). The router also exposes `getRoomByIndex(key, i)` and `hasRoomAndPlayer(key, i, j)` for observer resolution.

Routing-key parsing lives in a resolver. `createDefaultScenarioResolver(content, spawnBotFn)` recognises `r_{scenario_id}` and returns a fresh `DefaultScenarioOrchestration` for that scenario. Adding a new mode is adding a new resolver (or composing multiple); the router itself is mode-agnostic.

`GameServer.handleConnection` parses the URL in two shapes: `/observe/{key}/{i}/{j}` routes to the observer handler (snapshot + live tail), anything else is treated as a direct routing key (first path segment; empty path or `/` aliases to `r_demo`). The router handles or rejects; unknown keys close with 4004. `GameServer` keeps a `playerRoom` map so the lifetime of a world is "as long as any player is connected."

## MultiplayerRoom + ScenarioManager + Scenario

`MultiplayerRoom` owns a `World` instance (all events enabled), a player map (id → WebSocket + colour + index), a `pendingMoves: Map<playerId, Array<{clientTick, inputs}>>`, a monotonically increasing `serverTick`, an `NpcManager`, a `ScenarioManager`, and a drift-corrected self-rescheduling `setTimeout` loop driving `runTick()` at `1000 / this.tickRateHz` (default 20 Hz; overridden by `MultiplayerRoomOptions.tickRateHz`). The scheduler advances an absolute `nextTickAt` by the wall-clock interval after each tick and computes the next delay against `performance.now()`, so jitter at high tick rates does not accumulate. Sim-time per tick is always `1000 / TICK_RATE_HZ = 50 ms` regardless of the wall-clock rate — `world.processTick()` is not parameterised by `tickRateHz`. `MultiplayerRoom.isOpen()` returns `!this.closed` so the router can query the open state after the last default-open scenario has closed.

`MultiplayerRoom.addMap(map)` registers the map on the world (building scoped room ids + default adjacency), spawns the map's NPCs, and composes the map's `getRoomAtPosition` into the room's room-lookup function so scenarios see a unified resolver across all attached maps. It returns the scoped room ids contributed by the map for use when constructing scenarios.

`MultiplayerRoom.buildScenario(attachedRoomIds, config)` constructs a `Scenario` wired to the room's broadcast, send-to-player, scheduler, and room-position-lookup. The scenario's `ctx.closeScenario()` binding routes back to `MultiplayerRoom.handleScenarioClose(id)`, which clears the default-open slot in the manager and — if no default-open scenario remains — fires the orchestration's `onClose` callback so the router drops the room from its open list.

`MultiplayerRoom.scheduleSimMs(ms, cb)` is the single path for in-game timers. It converts `ms` to ticks (`ceil(ms / 50)`, minimum 1) and appends `{ targetTick, cb, cancelled }` onto an array drained at the end of every `runTick` after event emission. `Scenario.ctx.after`, `ButtonManager.startCooldown`, and `NpcManager`'s periodic triggers all route through this — there is no remaining `setTimeout`/`setInterval` usage inside `MultiplayerRoom` / `Scenario` / `ButtonManager` / `NpcManager`.

`Scenario` has three states: **created-not-started**, **started**, and **deleted**. Transitions are one-way (start() once, delete() once). While a scenario is created-not-started, `onPlayerAttach` still performs map/geometry/button bookkeeping and sends the player their initial geometry/room-visibility/button state, but the script's `onPlayerConnect` and `onPlayerReady` callbacks are suppressed and the ids accumulate in insertion-ordered sets. `start()` replays `script.onPlayerConnect` once per attached player (in attach order) then `script.onPlayerReady` once per ready player (in ready order). Subsequent attach/ready events flow through the normal path. Scheduled callbacks queued before `delete()` but due to fire afterward are silently dropped via an alive-gate on the per-scenario schedule wrapper. Production orchestration starts scenarios immediately on creation; only the `run-scenario` harness leaves a scenario created-not-started so the observer browser is recording before player lifecycle events fire.

`ScenarioManager.delete(id)` detaches every attached player first (calling `scenario.onPlayerDetach` to clear bookkeeping), then calls `scenario.delete()`, then removes the scenario from its map and clears the default-open slot if it was the default. The room's teardown path (`maybeTriggerRoomDone` after the last player leaves a closed room) calls `scenarios.destroyAll()` before firing `onRoomDone`.

`MultiplayerRoom.connectPlayer(ws)` is the single routing entry point: it allocates a `crypto.randomUUID()` player id, inserts the player at (0, 0), sends `welcome` (carrying `serverTick` and `tickRateHz`), sends `map_init` with the union of geometry specs across all attached scenarios, exchanges `player_joined` messages between the new player and each existing player (human and NPC), and calls `scenarios.attachPlayerToDefault(playerId)` — whose `Scenario.onPlayerAttach` sends the initial `geometry_state`, `room_visibility_state`, and `button_init` messages, and (if the scenario is started) fires `script.onPlayerConnect`.

`handleMove(playerId, clientTick, inputs)` appends every incoming move to `pendingMoves[playerId]` unconditionally — moves are never dropped, reordered, or rejected. `runTick()`:

1. Increments `serverTick`.
2. For each player, sorts `pendingMoves` by `clientTick`, flattens all inputs into a single array, and calls `world.queueMove(playerId, flat)`.
3. Calls `world.processTick()` to run all queued inputs and collect per-player events.
4. Merges NPC `onPlayerMove` events into the acting player's event list.
5. For each of the player's received moves, sends one `move_ack` back: `{clientTick, serverTick, x, z, events}`. All acks share the same `(x, z)` (end-of-tick position). Events are attached only to the last ack in the batch so the client applies each event exactly once.
6. For every other connected client, sends one `player_update` per moving player: `{playerId, x, z, events, serverTick}`. `touched` events are filtered so each receiving client sees only the pairs it participates in; all other events go to everyone.
7. For any `damage` event that drops HP to zero, calls `removePlayer(targetId, true)`.
8. Calls `ScenarioManager.onPlayerMoved(playerId)`, which forwards to the attached scenario's `onPlayerMoved` — recomputing vote-region assignment, button-occupancy, and room-enter transitions.

`connectPlayer` handles new connections and `removePlayer` handles disconnection / elimination. `removePlayer` calls `ScenarioManager.detachPlayer(playerId)` before deleting the player from the room's internal maps and broadcasting `player_left`.

The `instruction` message is sent directly to a single player by `MultiplayerRoom.sendToPlayer`; it is not broadcast and not subject to the render-tick buffer. It is triggered by the game script's `sendInstruction` capability. On the client, `useWebSocket.ts` converts `instruction` messages into a `showRule` call carrying the supplied rule lines, and the message surfaces as a rule popup (not a notification). Other paths (e.g. `ctx.sendNotification`) call `addNotification` in `gameStore.ts`, which uses a 2000 ms default duration.

## Client Network Layer (`positionBuffer.ts`, `useWebSocket.ts`)

`positionBuffer.ts` is a plain module (no React). Everything is keyed on integer server ticks; wall-clock time is never consulted for gating. Four sections:

**Server/render tick** (`registerServerTick`, `advanceRenderTick`, `getRenderTick`, `getServerWorldTick`): every inbound server message carrying a `serverTick` calls `registerServerTick(tick)`, which updates `serverWorldTick = max(serverWorldTick, tick)` and, on the first call with `serverWorldTick > 0`, initialises `renderTickFloat = serverWorldTick − BUFFER_TICKS`. `BUFFER_TICKS = 5`. `GameScene.tsx` calls `advanceRenderTick(delta)` once per frame at `useFrame` priority −3 (before any consumer reads the render tick). `advanceRenderTick` computes `target = serverWorldTick − BUFFER_TICKS` and advances `renderTickFloat` toward `target` at `delta × TICK_RATE_HZ × speed`. `speed` is 1.0 while `lag < SPEED_LO_MULT × BUFFER_TICKS`, ramps linearly toward 2.0 as `lag` grows to `SPEED_HI_MULT × BUFFER_TICKS`, and is clamped at 2.0 above that (`SPEED_LO_MULT = 1.5`, `SPEED_HI_MULT = 3.0`). `renderTickFloat` is clamped at `target` — it never advances past `server_world_tick − buffer`.

**Position snapshots** (`pushRemotePosition`, `getInterpolatedPos`): per-player arrays of `{tick, x, z}` keyed by `serverTick`, trimmed to a `MAX_BUFFER_AGE_TICKS = 40` window. Same-tick writes replace the previous value so NPC and script updates at the same tick don't double up. `getInterpolatedPos(id)` samples at `renderTickFloat` via binary search + linear interpolation between the two bracketing snapshots; returns the first snapshot while `renderTickFloat ≤ buf[0].tick` and the last while `renderTickFloat ≥ last.tick`.

**Event queues** (`pushRemoteEvents`, `consumeRemoteEvents`): per-player arrays of `{tick, event}`. `consumeRemoteEvents(id)` returns raw `WorldEvent[]` — it shifts and returns the wrapped events while `q[0].tick ≤ renderTickFloat`. The queue itself stores the `serverTick` key but it is not exposed on the returned events.

**move_ack queue** (`pushMoveAck`, `consumeMoveAcks`): a plain FIFO array of `MoveAck = {clientTick, serverTick, x, z, events}`. Acks may arrive faster than the frame loop consumes them (network bunching), so every ack is pushed and the whole array is drained together once per frame.

`useWebSocket.ts` routes each message to the store and `positionBuffer`. Every server message carrying a `serverTick` feeds `registerServerTick` (welcome, player_joined, move_ack, player_update).

## Client Local Player (`Player.tsx`)

`Player.tsx` creates its `World` lazily on the first `useFrame` after `playerId` is set. It maintains:

- `clientPredictiveTick` — monotonic counter, incremented at each 20 Hz send boundary.
- `clientWorldTick` — latest `serverTick` for which an ack has driven reconciliation; acks with `serverTick ≤ clientWorldTick` are stale and do not adjust position.
- `pendingInputs` — frame inputs accumulated in the current 50 ms tick window.
- `tickInputs: Map<clientTick, MoveInput[]>` — every sent tick's inputs, pruned only when the matching `move_ack` arrives. There is no maximum size; a disconnected server would leave entries to grow unbounded until reconnect resets the ref.
- `predictedPosPerTick: Map<clientTick, {x,z}>` — local player's predicted end-of-tick position for correction checks, pruned on the same per-ack schedule as `tickInputs`.

Each frame:

1. **Walkable sync**: if `store.activeWalkable` changed, call `world.setWalkable` then `world.snapAllPlayers()`.
2. **Consume acks**: drain `consumeMoveAcks()`. For each ack: delete its `clientTick` entries from `tickInputs` and `predictedPosPerTick`, and apply any `damage` events immediately. Acks with `serverTick ≤ clientWorldTick` are then skipped. Among the remaining, the ack with the newest `(serverTick, clientTick)` is selected as the reconciliation driver.
3. **Reconcile** (only if a driver exists): advance `clientWorldTick` to the driver's `serverTick`. If the driver's `(x, z)` differs from the recorded predicted end-of-tick by more than `CORRECTION_THRESHOLD = 0.0016` m (or no prediction was recorded for that `clientTick`), snap the local world to the ack position, reset every known remote player in the local world to their latest `getInterpolatedPos` value (so local collision prediction stays consistent), then replay every still-unacked tick in `tickInputs` in ascending order followed by the current frame's `pendingInputs`. Snap the Three group only if the post-replay world position differs from the rendered position by more than the same threshold, and update `animState` if the post-replay state changed.
4. **Predict this frame**: read joystick/tap input, call `world.processMove(playerId, jx, jz, delta)`, push `{jx, jz, dt: delta}` onto `pendingInputs`, and apply any `update_animation_state` events.
5. **Tick boundary**: if `performance.now() − lastTickTime ≥ TICK_MS`, assign the current `pendingInputs` to `tickInputs[tick]`, record the current predicted `(x, z)` to `predictedPosPerTick[tick]`, send `{type: 'move', tick, inputs}`, and increment `clientPredictiveTick`.
6. **Render**: write world position to the Three.js group.

Local input cadence is strictly 20 Hz. Variable-rate playback for remote catch-up lives in `advanceRenderTick`, never in the local input loop — distorting the user's own input cadence would change what the user actually did.

## Client Remote Players (`RemotePlayers.tsx`)

Each remote player starts hidden and becomes visible on the first position snapshot. Each `useFrame`:

- `getInterpolatedPos(id)` samples the remote buffer at the shared `renderTickFloat`; returns `null` while the buffer is empty (mesh stays hidden).
- `consumeRemoteEvents(id)` delivers every event whose tick `≤ renderTickFloat` this frame; events are routed to game (`damage`) and graphics (`update_animation_state`) handlers.

All remote players share the same `renderTickFloat`, so positions and events stay temporally aligned across the scene with no per-player wall-clock bookkeeping.
