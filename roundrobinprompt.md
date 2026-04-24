# Handoff: `/` hub — pack-then-round-robin policy + per-scenario transfer verification

You are picking up work on the `/` connection flow. The previous agent wired a
pluggable decision framework and flipped the default policy to
**"highest-player-count open MR, else round-robin across all four authored
scenarios"**. Your job is to **verify** that each of the four authored
scenarios (scenario1–scenario4) can actually receive a hub transfer correctly,
and fix anything that doesn't.

Read this whole document before touching code.

---

## What already shipped (do NOT redo)

### The decision framework

**New file**: `react-three-capacitor/server/src/orchestration/hubDecisions.ts`

Two pluggable hooks drive every `/` connection:

```ts
type ChooseExistingMultiplayerRoom =
  (ctx: HubDecisionContext) => { routingKey: string; instanceIndex: number } | null

type ChooseScenario =
  (ctx: HubDecisionContext) => string | null

interface HubDecisionContext {
  rooms: readonly RoomSummary[]     // MultiplayerRoomRegistry.listRooms()
  hubTargets: readonly string[]     // routing keys of scenarios with hubConnection
}
```

`RoomSummary` (defined in `MultiplayerRoomRegistry.ts`) carries
`routingKey`, `instanceIndex`, `roomId`, `openScenarioId`, `playerCount`,
`maxPlayers`, `isOpen`, `isHubSlotOpen`. Solo-hallway MRs are NOT in the
snapshot — they're never registered.

### The policy that's currently wired

In `react-three-capacitor/server/src/orchestration/resolvers.ts`:

```ts
new DefaultGameOrchestration({
  resolveHubTargets: () => listHubCapableRoutingKeys(content),
  chooseExistingRoom: chooseMostPopulatedOpenRoom,
  chooseScenario: createRoundRobinScenarioChooser(),
  ...
})
```

**Flow per `/` connection:**

1. Solo hallway MR created and the player is seated.
2. `chooseMostPopulatedOpenRoom` scans `registry.listRooms()` for any room
   where `isOpen && isHubSlotOpen` — returns the highest `playerCount`
   (ties broken by lowest `instanceIndex`). If found, transfer there.
3. Otherwise `createRoundRobinScenarioChooser()` returns the next scenario
   routing key from the pre-resolved `hubTargets` list (cursor advances
   per call). `findOrCreateHubSlot` is called on that scenario's
   orchestration — this creates a fresh MR the first time.
4. `acceptHubTransfer` seats the player; `world_reset` is sent; on
   `world_reset_ack` the reveal fires (walls drop, adjacency edge enables).

Hub targets today resolve to `scenarios/scenario1`, `scenarios/scenario2`,
`scenarios/scenario3`, `scenarios/scenario4` — every content scenario
declares a `hubConnection`. The order is whatever `ScenarioList.listScenarios()`
returns (persisted in `content/scenario_map.json`).

### Key files touched already

- `react-three-capacitor/server/src/ContentRegistry.ts` — `ScenarioSpec.maxPlayers` is required; `hubConnection` shape is `{ mainRoomId, dockGeometryId }`. `validateHubConnection` runs at content-load time.
- `react-three-capacitor/server/src/Room.ts` — `readonly maxPlayers`, `getPlayerCount()`, `getOpenScenarioId()`, `isHubSlotOpen()` (enforces capacity).
- `react-three-capacitor/server/src/MultiplayerRoomRegistry.ts` — `RoomSummary` type + `listRooms(filterKey?)`.
- `react-three-capacitor/server/src/orchestration/DefaultGameOrchestration.ts` — `resolveTarget()` runs the two-hook flow and handles snapshot→lookup races.
- `react-three-capacitor/server/src/orchestration/hubDecisions.ts` — also exports `chooseFirstOpenScenario2Room` and `chooseAlwaysScenario2` as the pre-refactor first-pass policies if you need to bisect.

---

## Your task: verify each scenario accepts transfers correctly

The framework is wired. `validateHubConnection` catches dock-geometry
misconfigurations at content-load. But nothing has actually tested that a
live hub transfer into each scenario **runs its script correctly** once the
player walks through the hallway into the main room. That's what you need
to confirm.

### The four scenarios and their hub entry points

| Scenario | mainRoomId | dockGeometryId | Script on-connect behavior |
|---|---|---|---|
| scenario1 | `main` | `s1_ws` | Activates vote regions, sends `find_instruction`; `closeScenario()` once 4 players. |
| scenario2 | `room1` | `r1_s` | Registers `onPlayerEnterRoom`; bot-fills 5s after first `room1` entry; opens north door when all 4 ready. |
| scenario3 | `main` | `s3_ws` | Activates `s3_rzone` vote region; registers button handlers. |
| scenario4 | `south_hall` | `s4_s_s` | **Empty** — no `onPlayerConnect`, no `onPlayerReady`. Players arrive and nothing happens. |

### What "accepts transfers correctly" means

For each scenario, confirm:

1. **Hub transfer completes**: the player gets seated in the main room via
   the hallway without errors in the server log. `acceptHubTransfer`
   succeeds; `world_reset` is acked; walls drop; adjacency enables.
2. **`onPlayerConnect` fires with the transferred playerId** after the
   reveal — not with the solo-hallway id. (The hub flow uses
   `seatPlayer` → a fresh id is assigned inside the target MR, and the
   scenario's `ScenarioManager.attachPlayerToDefault` is called from
   `acceptHubTransfer`.)
3. **The scenario's expected side effects are observable** after connect:
   instructions sent, vote regions activated, listeners registered,
   bot-fill timers scheduled.
4. **The hub slot correctly reopens** once the player crosses from the
   hallway into `mainRoomId`. Subsequent `/` connections should be able
   to pack into the same MR (verify via `registry.listRooms()` showing
   `isHubSlotOpen: true` and `playerCount` incrementing).
5. **Capacity gating works**: when `playerCount === maxPlayers`,
   `isHubSlotOpen()` flips to false and new `/` connections create a
   fresh MR (or pack into a different open one).

### Per-scenario concerns to dig into

- **scenario2**: `onPlayerEnterRoom` handler registration is on `onPlayerConnect`, which only runs the first time a player connects. For a hub-transferred player, connect happens after the hallway is attached — confirm the listener IS registered before the player crosses `scenario2_room1`. Also confirm the `BOT_FILL_DELAY_MS` timer fires on `room1` entry (not on hallway entry).
- **scenario1**: `closeScenario()` at ≥4 players — confirm this properly flips `hubSlotOpen` to false so the registry stops targeting the room, but existing players (including the newly transferred one) keep receiving script events. Check that subsequent `/` visitors cleanly fall through to the next round-robin target.
- **scenario3**: similar to scenario1 but without the close-at-4 logic. Confirm vote region activation on transfer works (the region should be active for the arriving player's client, not just the ones that were there before).
- **scenario4**: **empty script** — verify that this is acceptable or decide it needs meaningful on-connect content. An empty scenario still exercises the transfer machinery cleanly, but it's arguably a content bug for the round-robin to send players to a no-op. Raise this with the user or populate scenario4 with at least a welcome instruction.

### How to verify

Options in increasing fidelity:

1. **Static read**: read each scenario script end-to-end with the hub
   transfer flow in mind. Confirm `onPlayerConnect` / listener registration
   doesn't assume the player spawned inside the main room — hub players
   spawn in the hallway first.

2. **run-scenario CLI** (`server/scripts/run-scenario.ts`):
   - Today this drives a direct `scenarios/<id>` connection, NOT a hub
     transfer. If you want to test the hub path, either extend the CLI
     to route through `hub` or write a small harness that connects a
     test WebSocket client to `/` and asserts the expected message
     sequence. The existing `scenariorun/` flow doesn't cover this.
   - Check `tools/src/runScenario/` and the related agent under
     `tools/src/agents/runScenarioAgent.ts` for precedent.

3. **Manual browser session**: boot the dev server
   (`npm run dev` — check `package.json` for exact script), open `/` in
   four browser tabs, confirm each one goes to a different scenario
   (round-robin) on cold start, then a fifth tab packs into whichever
   scenario had the highest count by then. Use `/observe/<key>/<i>/<j>`
   to spectate.

4. **Unit test** against `MultiplayerRoomRegistry` + the two choosers:
   construct a registry with a few stub rooms, feed it to
   `chooseMostPopulatedOpenRoom`, assert the winner. This only covers
   the decision logic, not the transfer path — but it's the cheapest
   regression guard.

### Known race to keep in mind

The existing-room path in `DefaultGameOrchestration.resolveTarget()`
re-checks `room.isOpen() && room.isHubSlotOpen()` after
`getRoomByIndex(...)` because the snapshot is a read and the room may
close or fill between listRooms() and the lookup. If that check fails the
code falls through to `chooseScenario(ctx)`. Preserve that fallback — if
you refactor, don't assume the snapshot state is still live.

### Swapping back to first-pass behavior for bisection

If transfer behavior regresses, you can flip the policy in one place by
changing `resolvers.ts`:

```ts
// Pre-refactor behaviour: always scenario2, reuse first open scenario2 room.
chooseExistingRoom: chooseFirstOpenScenario2Room,
chooseScenario: chooseAlwaysScenario2,
```

Both are exported from `hubDecisions.ts`. If the first-pass policy works
but the upgraded one doesn't, the bug is in either
`chooseMostPopulatedOpenRoom` or a scenario that wasn't getting hub traffic
before.

---

## What you should deliver

1. A verification report for each of scenario1–scenario4: does the hub
   transfer path work end-to-end? What did you test, and what did you
   observe?
2. Fixes for any scenario that can't receive a transfer correctly. Most
   likely culprits: script assumes the player spawned in the main room,
   listener registration is gated on a path hub players don't take, or
   the dock geometry placement disagrees with what the script expects.
3. A decision on scenario4: leave empty, add a minimal welcome script, or
   remove it from the hub-target list (by dropping its `hubConnection`).
   Confirm with the user before dropping.
4. If any of the transfer-flow assumptions break under the upgraded
   policy (e.g. a scenario only worked because it was always the first
   target), document the root cause in a commit message and fix it at
   the right layer — not by reverting the policy.

Do NOT expand the scope into refactoring the hub transfer machinery
(`Room.acceptHubTransfer`, `computeHubAttachment`, etc.) unless a specific
scenario's failure requires it. The framework is intentionally narrow.
