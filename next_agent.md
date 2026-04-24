# Hub Orchestration — Handoff

## Goal

`/` (empty path) is a "hub" route. Players visiting `/` should see the
`initial` hallway attached at a scenario-specified point to a target
scenario's main room, walk out of the hallway, and enter that scenario
seamlessly. First pass target scenario is `scenario2`.

## What's in place

### Routing

- `react-three-capacitor/server/src/GameServer.ts` — `parseRoutingKey`
  routes the empty path to `'hub'` (was `'r_initial'`).
- `react-three-capacitor/src/network/useWebSocket.ts` — client `getWsPath`
  also maps empty → `'hub'`.
- `react-three-capacitor/server/src/orchestration/resolvers.ts` — the
  `'hub'` routing key resolves to a `HubOrchestration` configured against
  `scenario2`'s content. `r_scenario2` and friends still resolve to the
  existing `DefaultScenarioOrchestration`.

### Single-MR hub (first-pass simplification)

The original plan described an MR1→MR2 transfer with `rebase` and
`map_extend` wire messages. I intentionally collapsed that for the first
pass into a **single combined MultiplayerRoom** that contains both maps
from the start. No transfer, no rebase messages, no client networking
changes.

`react-three-capacitor/server/src/orchestration/HubOrchestration.ts`:

- Builds one `MultiplayerRoom`.
- `addMap(INITIAL_MAP)` at default origin (0, 0).
- `addMap(shiftedScenario2)` at origin `(0, -1.125)` — chosen so
  scenario2's `r1_s` wall meets initial's `initial_wn` wall at the world
  boundary `z = -0.75`.
- Toggles `initial_wn` and `r1_s` off at room construction time.
- Calls `world.setConnectionEnabled('initial_hall', 'scenario2_room1', true)`.
- Adds scenario2's `ScenarioSpec` as the **default** scenario and starts
  it. No `HubScenario` — the target script runs directly.

Orchestration index/exports are wired (`orchestration/index.ts`).

### Geometry placement math (as built)

- Initial hallway: floor `z ∈ [-0.75, +0.75]`, `initial_wn` centered at
  `z = -0.7375`.
- Scenario2 shifted by `(0, -1.125)`: `room1` floor `z ∈ [-1.5, -0.75]`,
  `r1_s` centered at `z = -0.7625`.
- The two walls share a common face at `z = -0.75`. Dropping both creates
  a passable seam.
- Spawn is the authored `(0, 0.5)` — inside initial's hallway, facing
  north.

## Observations from manual testing (NOT yet fixed)

These four issues are the next agent's task.

1. **Client only sees the initial hallway**, never scenario2's rooms, even
   after crossing the seam.
2. **Bots from scenario2 spawn at the hub spawn point**, not inside
   scenario2 (they appear standing in the initial hallway).
3. **Scenario2's rooms are never rendered on the client** at all.
4. **The attach-point must move onto scenario2**. Right now the
   orchestration hardcodes `'scenario2_room1'` + `'r1_s'` + origin
   `(0, -1.125)`. Scenario2 should own this: "the initial hallway attaches
   south of my main room, at wall X, position Y". The hub orchestration
   should be a generic placement engine driven by a field on
   `ScenarioSpec`.

## Diagnoses and fix guidance

### (1) + (3): Client can't see scenario2 geometry

Root cause: the client's `CURRENT_MAP` for `/` is `INITIAL_MAP`
(`content/maps/index.ts` resolves empty scenario id to initial). Several
client modules filter/compute using `CURRENT_MAP` only:

- `src/scene/GeometryLayer.tsx` — computes `visibleRoomIds` from
  `CURRENT_MAP.getAdjacentRoomIds(currentRoomId)` and filters every wire
  geometry piece with `visibleRoomIds.has(obj.roomId)`. Scenario2's
  scoped ids (`scenario2_room1`, etc.) aren't in the adjacency map, so
  all scenario2 geometry is filtered out.
- `src/scene/GameScene.tsx` — iterates `CURRENT_MAP.rooms` to render
  floors/outside-textures. Builds scoped ids via
  `` `${CURRENT_MAP.mapInstanceId}_${r.id}` ``. Scenario2 rooms aren't in
  this list so their floors/ground don't render.
- `src/scene/RemotePlayers.tsx` — same pattern for remote-player
  visibility.
- `src/hud/HUD.tsx` — room-name lookup via CURRENT_MAP.
- `src/scene/Player.tsx` — `w.addMap(CURRENT_MAP)` for local prediction;
  `CURRENT_MAP.getRoomAtPosition` for currentRoomId tracking.

The ServerMessage `map_init` already carries all geometry with correct
scoped `roomId`s — the data is reaching the client, it's being filtered
out.

**Recommended fix**: provide a client-side `HUB_MAP` GameMap that
composes INITIAL_MAP + scenario2's map shifted to match the server's
placement, and have `content/maps/index.ts` return HUB_MAP for the empty
URL path. Key constraints:

- Scoped room ids produced by the composed map MUST match the server's
  wire format (`initial_hall`, `scenario2_room1`, `scenario2_room2`,
  `scenario2_room3`).
- `getAdjacentRoomIds('initial_hall')` must include `'scenario2_room1'`
  (the hub-added cross-instance edge).
- `roomPositions` must contain scoped entries for every room in both maps
  at their hub-world-space centres.
- `cameraShapes.rects` and `.zones` must cover both maps at their world
  positions.
- `getRoomAtPosition` must return the scoped id for either map's rooms.
- `rooms` list iteration: `GameScene.tsx` line 99 builds scoped ids via
  `` `${CURRENT_MAP.mapInstanceId}_${r.id}` ``. The simplest way to keep
  that working is to make the composed map's room entries carry ids that,
  when prefixed with the composed `mapInstanceId`, yield the right scoped
  string.

Two viable shapes for HUB_MAP:

**(A) Delegate helper functions, keep `rooms` and `mapInstanceId` as a
pair that yields one of the sub-maps' scopes.** You can't get two
different prefixes from a single `mapInstanceId`. So this requires also
changing the callsites in `GameScene.tsx` / `RemotePlayers.tsx` /
`HUD.tsx` to go through a helper (e.g. `map.scopeOf(room)`) instead of
manually concatenating `mapInstanceId` with `room.id`. Add
`scopeOf(r: RoomSpec): string` to GameMap; default implementation
unchanged; HUB_MAP overrides it with a room→scoped lookup.

**(B) Author the composed rooms with pre-scoped ids in `room.id` and
make `mapInstanceId` empty** — then special-case empty `mapInstanceId`
at the callsites to skip the prefix. Less elegant but a smaller patch.

(A) is cleaner. Either way, touch: `GameMap.ts`, `GameScene.tsx`,
`RemotePlayers.tsx`, `HUD.tsx`, `GeometryLayer.tsx`, and
`content/maps/index.ts`.

Also update `src/scene/Player.tsx`: `w.addMap(CURRENT_MAP)` is used to
register per-room bounds + Rapier colliders in the local prediction
World. For the hub this needs both maps' data. Easiest: `addMap(INITIAL)`
then `addMap(shiftedScenario2)` — mirror what the server does. (Or, if
HUB_MAP is a real GameMap, make it call addMap twice internally or
make a separate registration flow.)

### (2): Bots spawn in the hallway

Root cause: `MultiplayerRoom` has a single `spawnPosition` passed at
construction, used for every `connectPlayer` call (humans and bots).
HubOrchestration sets `spawnPosition = HUB_SPAWN = (0, 0.5)` — inside
initial. scenario2's `fillBots` spawns bots via the `'hub'` routing key,
so they come back through `HubOrchestration.createRoom` → no, actually
they come through `RoomRouter.pickOpenRoomForKey` and reuse the existing
hub MR. Bots then get spawned at `HUB_SPAWN` too.

**Recommended fix**: support a per-player spawn override. Options:

- Add an optional `spawnPosition` param to `MultiplayerRoom.connectPlayer`
  and plumb it through. Then in `GameServer.handleConnection`, for bots
  connecting to `'hub'`, pass scenario2's natural spawn (or a
  hub-orchestration-provided "target-world spawn").
- Simpler but less clean: identify bot connections (they send a header
  or pick a URL flag) and route them to a different spawn.
- Cleanest: the orchestration provides a `spawnFor(connection): {x, z}`
  hook rather than a single `spawnPosition`. Hub returns
  `HUB_SPAWN` for human connections and scenario2's authored spawn
  (shifted by the scenario2 origin offset) for bot connections.

The scenario2 script already references `ctx.spawnBot(spec)`. The bot
URL is bound to the enclosing routing key — `'hub'` in this case. There
is no built-in way today to say "spawn the bot as if it were joining
`r_scenario2`". Either add that to the orchestration API or split bot
spawning so scenario2 requests a bot in *its own* coordinate frame and
the orchestration translates it.

Also worth considering: when the hub is the default and scenario2 is
reached via hub, should scenario2's bot-fill even run? The original
intent (4-player ready in room1) assumes players spawn in room1.
Bot-fill in hub mode may not make sense at all; it might be simpler for
the first pass to have the hub orchestration **suppress bot spawns** for
scenario2 and let the human walk in alone, deferring the
"bots-in-correct-room" problem.

### (4): Scenario2 owns the attach point

Today the attach math is hardcoded in
`HubOrchestration.ts`: `TARGET_HUB_ORIGIN = (0, -1.125)`, the wall ids
`'initial_wn'`/`'r1_s'`, and the adjacency target `'scenario2_room1'`.
None of this belongs in a generic hub — a different target scenario
would have different main-room dimensions, different wall ids, and a
different attach wall.

**Recommended fix**: add a `hubConnection` field to `ScenarioSpec`
(see `react-three-capacitor/server/src/ContentRegistry.ts`) describing,
on the scenario's own terms, where the initial hallway attaches:

```ts
// On ScenarioSpec:
hubConnection?: {
  mainRoomId: string        // local room id inside the scenario's map, e.g. 'room1'
  wallSide: Wall            // 'south' | 'north' | 'east' | 'west'
  wallGeometryId: string    // the toggleable wall id, e.g. 'r1_s'
  positionOnWall: number    // 0..1 along the wall; initial's width is 0.25
}
```

Populate it on `content/scenarios/scenario2/scenario.ts`:

```ts
hubConnection: {
  mainRoomId: 'room1',
  wallSide: 'south',
  wallGeometryId: 'r1_s',
  positionOnWall: 0.5,
}
```

HubOrchestration then derives `TARGET_HUB_ORIGIN` from this declaration:

- Look up the main room's authored `cz` (from its centre) and floor half-
  depth. For `wallSide: 'south'`, the wall face sits at the room's
  southern floor edge (local `z = +floorDepth/2`).
- Place the initial hallway so its `initial_wn` face meets the same
  world z. Initial's `initial_wn` local `cz = -0.7375`, so the hallway's
  origin shift equals `(mainRoomCenter.world_z + floorDepth/2) +
  (0.75)` on the right side of equation (work it out per wallSide — the
  existing code already hardcodes the `south` case and you just need to
  generalise).
- Support `north`/`east`/`west` by rotating the same math; or, for first
  pass, assert `wallSide === 'south'` and defer the other sides.

The `positionOnWall` field lets the scenario say "initial attaches at
x=0.5 of this wall"; for a hallway narrower than the room that
translates into an x offset of
`(positionOnWall - 0.5) * (wallLength - hallwayWidth)` or similar.

Once hubConnection drives placement, also rename / replace the hardcoded
`'initial_wn'` drop with logic that picks the initial wall that faces
the scenario (again, the opposite cardinal of `wallSide`).

## Validation checklist for the next agent

After the fixes:

- `/` loads. Client sees initial hallway and scenario2's room1 (+ room2
  if rendered), floors drawn correctly.
- Walking north from spawn takes the player from the hallway into room1
  without teleport or visible wall.
- Any bots scenario2 spawns appear inside room1 (their natural spawn)
  not in the hallway.
- Scenario2's attach metadata is declared on its ScenarioSpec and the
  hub orchestration has no scenario-specific constants.
- `r_scenario2` still runs scenario2 standalone (existing behaviour is
  preserved — `hubConnection` is purely additive).

## Files touched so far

- `react-three-capacitor/server/src/orchestration/HubOrchestration.ts` (new)
- `react-three-capacitor/server/src/orchestration/index.ts` (export)
- `react-three-capacitor/server/src/orchestration/resolvers.ts` (`hub` branch)
- `react-three-capacitor/server/src/GameServer.ts` (`parseRoutingKey`)
- `react-three-capacitor/src/network/useWebSocket.ts` (`getWsPath`)

All other plan items (rebase/map_extend wire messages,
`MultiplayerRoom.acceptHubTransfer`, HubRouter, WorldSpec.origin
factories, per-player id remapping) were intentionally dropped for the
first pass and are NOT implemented. They are still the right shape for
a second pass that supports MR1→MR2 transfer between live rooms, but
the four observations above should be resolved first inside the
single-MR model.
