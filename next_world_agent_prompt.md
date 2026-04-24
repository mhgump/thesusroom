# Next Agent Prompt — Room Orchestration Framework & Routing

This document briefs you on the current framework so you can make the next change. Read it end-to-end before touching code.

## The product

A multiplayer 3D top-down "rooms" game. Players join by WebSocket, walk around maps composed of connected rooms, and play scripted scenarios (demo, scenario1..4). Client is React + @react-three/fiber + zustand under `react-three-capacitor/src`. Server is Node + `ws` under `react-three-capacitor/server/src`. Content (maps, scenarios, bots) lives under `content/`.

## Documentation structure

The project maintains three directories — always keep them in sync when behavior changes:

- `spec/` — what the system must do (bulleted precise statements, no mechanism).
- `assumptions/` — non-obvious facts about the current implementation.
- `implementation/` — how the code achieves the spec (sections with file refs).

Rules in `/Users/michaelgump/thesusrooms/documentation_guidelines.md`. Components are: `ux`, `client-hud`, `game`, `graphics`, `scene`, `server-client`, `npc`, `game_script`, `bot`.

## Current runtime model (after the recent refactor)

### Data model

- **`GameMap`** (`react-three-capacitor/src/game/GameMap.ts`) — a static map definition carrying `worldSpec`, `walkable`, optional `physics`, `gameSpec`, `npcs`, plus:
  - `mapInstanceId: string` — used to scope room ids as `{mapInstanceId}_{localRoomId}`. In the current deployment each shipped map sets this to its scenario id (`demo`, `scenario1`, …).
  - `getRoomAtPosition(x, z)` → scoped id or null.
  - `getAdjacentRoomIds(scopedId)` → scoped ids reachable from the given room (map defaults).
  - `isRoomOverlapping(scopedId)` → whether this room intersects another room in world space (hidden by default on the client if so).
  - `roomPositions: Map<scopedId, RoomWorldPos>` — scoped-keyed.
  - Inside the file, `worldSpec.rooms[i].id` / `worldSpec.visibility` still use **local** ids. Scoping happens once at build time through `buildMapInstanceArtifacts(...)` in `react-three-capacitor/src/game/MapInstance.ts`.

- **`World`** (`react-three-capacitor/src/game/World.ts`) — the live player+physics sim. Shared between client and server (the server's `World.ts` re-exports the client file). Gains:
  - `addMapInstance(instance: WorldMapInstance)` — registers scoped ids + default adjacency from a map.
  - `getPlayerRoom(id)` / `setPlayerRoom(id, scopedId | null)` — per-player current room.
  - `getAccessibleRooms(id)` — override if any, else `{currentRoom} ∪ defaultAdjacency(currentRoom)` from any registered map instance.
  - `setAccessibleRoomsOverride(id, scopedIds | null)` — not yet called by anything; exists for future scenario-scope enforcement.
  - Physics is still walkable-area + optional Rapier. Accessible rooms are *not* currently enforced; movement is gated by walkable geometry only. This is deliberate — the current deployment's default accessibility matches the walkable graph by construction.

- **`Room`** (`react-three-capacitor/server/src/Room.ts`) — the server-side multiplayer "websocket room". Owns exactly one `World`, one map instance, one attached `GameScript`. Tracks players (with colour + per-WS), NPC manager, pending moves, 20 Hz tick loop. Exposes `registerMapInstance(WorldMapInstance)` (called by the registry immediately after construction) and `addPlayer(id, ws)` / `removePlayer(id)` / `handleMove(...)`.

- **`GameScript`** + **`GameScriptManager`** (`server/src/GameScript.ts`, `GameScriptManager.ts`) — per-room script; context exposes `sendInstruction`, `toggleVoteRegion`, `onVoteChanged`, `after`, `setGeometryVisible`, `setRoomVisible`, `onPlayerEnterRoom`, `closeScenario`, `spawnBot`, `addRule`, etc. `GameScriptManager.onPlayerMoved` now also calls `world.setPlayerRoom(...)` on every scoped-room transition.

- **`ScenarioSpec`** (`server/src/ScenarioRegistry.ts`) — `{id, scriptFactory, initialVisibility?, initialRoomVisibility?, requiredRoomIds?, timeoutMs, onTerminate}`. `requiredRoomIds` are scoped ids asserted at room creation; missing ids throw. `timeoutMs` + `onTerminate` are used only by `server/scripts/run-scenario.ts` (CLI harness), **not** by the production server.

### Runtime lifecycle (what actually happens)

Routing: `GameServer.handleConnection` (`server/src/GameServer.ts`):
1. Parse `/observe/{scenarioId}/{i}/{j}` → observer flow (read-only snapshot + live tail); unchanged.
2. Else parse first URL path segment as `scenarioId` (empty/`/` → `demo`).
3. `registry.getOrCreateRoom(scenarioId)` → existing open `Room` or new one; reject with close code 4004 if unknown.
4. Assign `playerId = crypto.randomUUID()`, stash in `playerRoom` map, `room.addPlayer(playerId, ws)`.

`ScenarioRegistry.getOrCreateRoom(scenarioId)` (`server/src/ScenarioRegistry.ts`):
1. If an entry exists in `openRooms[scenarioId]`, return it. **Only one room per scenario id is "open" at a time.**
2. Else find a null slot in `allRooms[scenarioId]` (for stable observer index reuse) or append a new slot index.
3. Assert `requiredRoomIds` are in `map.worldSpec.rooms`.
4. Build the `Room` (passes walkable, npcs, gameSpec, initialVisibility maps, scriptFactory(), `onCloseScenario` cb that deletes from `openRooms`, `onRoomDone` cb that nulls out the `allRooms` slot, walkableVariants, `map.getRoomAtPosition`, spawnBotFn, physics, toggleVariants).
5. Derive `scopedRoomIds` and `defaultAdjacency` from the map and call `room.registerMapInstance({mapInstanceId, scopedRoomIds, defaultAdjacency})`.
6. Stash into `allRooms[scenarioId][idx]` and `openRooms[scenarioId]`.

Closing: the script calls `ctx.closeScenario()` → `onCloseScenario` fires → `openRooms.delete(scenarioId)`. The room keeps running for its current players. When the last player leaves, `Room.maybeTriggerRoomDone` fires `onRoomDone` → nulls the `allRooms` slot and stops the tick.

Bots: `GameScriptContext.spawnBot(spec)` → bot server-side callback → `BotManager.spawnBot(scenarioId, spec)` → `new BotClient(serverUrl, scenarioId, spec).start()` → opens `ws://{server}/{scenarioId}`. Bots connect through the same URL path as humans. Bots are allowed to bypass the "open" gate because the scenario is the one spawning them (the registry still returns the same open room, but the close-in-progress order matters).

Observer: `/observe/{scenarioId}/{i}/{j}` where `i` is the `instanceIndex` in `allRooms[scenarioId]` and `j` is a per-room player index assigned by `Room.nextPlayerIndex++`. Snapshot replay + live tail via `room.registerObserver(...)`.

### Where the "orchestration mode" logic lives today

The "orchestration mode" of every shipped scenario is hardcoded as: **one world, one map, one scenario, one open slot per scenario id, close-on-script-call, destroy-on-last-disconnect**. This logic is spread across:

- `ScenarioRegistry.getOrCreateRoom` — assembles the room, registers the map instance, gates single-open-room policy.
- `Room` constructor — instantiates World, GameScriptManager, NpcManager, tick loop.
- `Room.onRoomDone` / `maybeTriggerRoomDone` — close lifecycle.
- `ScenarioSpec.scriptFactory` — the attached-script factory.

There is currently **no seam** for a different orchestration mode — the registry does everything up front for one particular policy.

### Client-side URL

`content/maps/index.ts` derives `CURRENT_SCENARIO_ID` from `window.location.pathname` (first segment, default `demo`), then picks the matching `GameMap` from a static record. The client uses this id only to pick the map; the server sees the same path and routes the WS connection.

---

## Your task

### Part 1: Extract a Room Orchestration Mode framework

Refactor the "how a multiplayer room is assembled and closed" logic out of `ScenarioRegistry` + `Room` + `ScenarioSpec` into a pluggable framework with multiple implementations.

Conceptually a **Room Orchestration Mode** decides:
1. What maps are loaded into the world (one today; could be several later).
2. What scenarios are attached and to which subsets of players and rooms.
3. When the room "closes" (stops accepting new connections).
4. When the room is destroyed.

The shipped default should be `DefaultScenarioOrchestration` — the current behavior, extracted without semantic change: one world, one map, one scenario, one open slot per routing key, close via `ctx.closeScenario`, destroy when last player disconnects. After the refactor every shipped scenario still runs exactly as before.

Suggested shape (not prescriptive — use your judgment):

```ts
interface RoomOrchestration {
  // Build fresh mutable state for one room. Called when the framework decides
  // it needs a new open room for this mode.
  createRoom(deps: OrchestrationDeps): Room
  // Called by the framework when a player arrives. Most modes just call
  // room.addPlayer; some may route between sub-worlds, gate on scenario
  // state, etc.
  onPlayerArrive(room: Room, playerId: string, ws: WebSocket): void
  // True iff this room still accepts new connections. The framework reads
  // this on each new arrival to decide open-vs-create.
  isOpen(room: Room): boolean
}
```

Things to fix as you refactor, not just preserve:

- The `Room` constructor today takes ~18 positional arguments. Introduce a single options object (or build helpers) as you move code around.
- `ScenarioSpec` currently carries `requiredRoomIds`, `initialRoomVisibility`, `initialVisibility` — those describe a scenario's content, not the orchestration policy. Keep them on the scenario spec, not on the orchestration.
- `ScenarioSpec.timeoutMs` + `onTerminate` are only referenced from `server/scripts/run-scenario.ts`. Do not plumb them into the production path; either keep them scoped to that harness or delete if you confirm they are dead.
- The `allRooms[scenarioId]` index used by observer routing needs a home in the new framework. Observer IDs (`i`, `j`) must still be stable for live sessions — breaking them breaks the cloud review observer tool.

Write new source files under `server/src/orchestration/` (or similar). Put the default implementation there. Delete whatever in `ScenarioRegistry` becomes redundant.

### Part 2: Generalize server routing

Today `/foo` means "scenario id foo". Replace this with a **routing key** framework where keys explicitly name both the orchestration mode and whatever parameters it needs.

For this pass there is **one** recognised key shape:

- `r_{scenario_name}` → default scenario orchestration mode for that scenario (map = the scenario's declared map).

Other URL paths besides `/observe/...` should be rejected. Future keys will extend this registry (e.g. other orchestration modes, matchmaking pools), so the key parser must be pluggable.

Routing behavior per key:

1. The server maintains `openRooms: Map<routingKey, Room[]>`.
2. When a player connects for a key, pick a random open `Room` from the list, or create a new one if the list is empty.
3. When a room becomes not-open (`isOpen === false`), remove it from the open list for that key. Players already connected stay connected.
4. When a room is destroyed (last player disconnects), clean up any remaining tracking.
5. Observer path `/observe/{key}/{i}/{j}` continues to work — the `{key}` is now the routing key (`r_demo` etc.), `{i}` indexes into the all-rooms list for that key, `{j}` is the per-room player index. The observer tool (`content/` tooling and anything under `tools/`) needs to keep working; update clients accordingly.
6. Reject unknown keys with close code 4004 as today.

You will need to update the client URL handling too:

- `content/maps/index.ts` parses `window.location.pathname` for `CURRENT_SCENARIO_ID`. Update it to parse `r_{name}` and extract the scenario name, then keep picking the map from the static record. Default when no path is given → `r_demo`.
- `BotClient` constructs `ws://{server}/{scenarioId}` (`server/src/bot/BotClient.ts`). Update it to use `r_{scenarioId}`.
- `GameScriptContext.spawnBot` path through `BotManager.spawnBot(scenarioId, spec)` — update the routing-key construction there, not inside scripts.
- Anything that hard-codes `/demo`, `/scenario1`, etc. in docs, scripts, or dev tooling — search the repo (`demo`, `/scenario`) and update.

Pre-warming (`registry.prewarm('demo')`) should become pre-warming a routing key (`prewarm('r_demo')`).

### Part 3: Keep docs in sync

After the code lands, update:

- `spec/server-client.md` — the section on routing / open registry needs to reflect the new key scheme and the multi-open-rooms-per-key policy (currently says "an instance is open when its attached scenario still accepts new connections" and "A player connecting to `/{scenario_name}` is routed to the open world for that scenario"). Preserve all other content.
- `assumptions/server-client.md` — add assumptions: key format `r_{scenario}`, random pick among open rooms, open list maintenance.
- `implementation/server-client.md` — new section on orchestration modes; update Relevant Files; describe the routing key parser.
- `spec/game_script.md` — the "A world instance has at most one open scenario at a time" bullet and "Newly connecting players are attached to the open scenario" bullet are still correct for the default orchestration, but frame them as properties of the default mode rather than of every world. Update precisely.
- `assumptions/bot.md` and `implementation/bot.md` — bot URLs now use `r_{scenarioId}`.

Do not duplicate spec content across layers. Follow `/Users/michaelgump/thesusrooms/documentation_guidelines.md`.

### Part 4: Verify

- `react-three-capacitor` and `react-three-capacitor/server` must both `tsc --noEmit` clean after the change.
- Run the scenario harness for at least demo: `cd react-three-capacitor/server && npm run dev` (or however `scripts/run-scenario.ts` is invoked — check the package scripts) and open `http://localhost:{PORT}/r_demo` in a browser. Verify the game loads and a player spawns.
- Observer should still work for an active room: `/observe/r_demo/0/0` should connect to player-0 of the first demo room.
- Bot fill on the demo scenario (2s timer spawns bots to fill to 4) should still trigger.

## Pointers and pitfalls

- The client's `CURRENT_MAP` is resolved at module-load from the URL. If you change the key format, the client-side module-load must parse both `r_{name}` and tolerate the observer path (`/observe/...` — in that case the client is running as observer and may need a different map resolution; read `content/maps/index.ts` carefully and check what happens today when a user loads `/observe/...`).
- `demo` is pre-warmed at server startup. The default orchestration's `prewarm` semantics need to survive the refactor.
- The `Room`'s private `world` field: I recently added `registerMapInstance` as a thin forwarder. If you restructure `Room`, preserve a public way to register map instances from the orchestration layer (or fold the construction into a helper the orchestration owns).
- `ScenarioRegistry` has three maps today: `entries` (id → `{map, scenario}`), `openRooms`, `allRooms`. In the new framework `entries` belongs to the content registry; the other two belong to the routing/orchestration layer.
- Scenarios 1–4 don't currently declare `requiredRoomIds`. Don't change their content as part of this refactor — the assertion is optional for a reason.
- Don't refactor the physics / touch / tick / network-protocol layers; they are orthogonal to this change.

## Working rules (from the repo)

- Only create commits when the user explicitly asks. If a commit is appropriate, pass `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` and do not amend prior commits.
- Prefer editing existing files to creating new ones, except where a new module is architecturally necessary (the orchestration framework is such a case).
- No comments on obvious code. Document the *why* when it's non-obvious.
- When you finish code, update docs. When you finish docs, don't over-duplicate across layers.
- If you're unsure about a breaking change to observer URLs or bot URLs, stop and ask the user before shipping it.
