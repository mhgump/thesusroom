# Fix north-edge exit docks for every scenario

You're working in the `thesusrooms` repo at `/Users/michaelgump/thesusrooms`. Scenarios in `content/scenarios/` now participate in a loop: scenario → exit-hallway MR → random next scenario. Each scenario needs an `exitConnection` on its `ScenarioSpec` pointing at a dock that the walk-out hallway attaches to. The exit transfer is implemented in `react-three-capacitor/server/src/orchestration/exitTransfer.ts` and validated at content-load time by `validateExitConnection` in `react-three-capacitor/server/src/orchestration/hubAttachment.ts`.

## Your task
Author a north-edge exit dock on the terminal room of each remaining scenario and wire it into the scenario spec + terminal script handler. Reference scenario1 as the working example — it already has this done.

## Hard constraints (enforced by `validateExitConnection`)
Read `react-three-capacitor/server/src/orchestration/hubAttachment.ts` (`assertOnNorthEdge`, `assertWidthMatchesHallway`, `assertWithinWallSpan`) for exact checks. Summary:

1. **Dock must sit on the exit room's north edge.** `dock.cz - dock.depth/2` must equal `-room.floorDepth/2` (within 1e-4). In practice: mirror whatever other north-edge walls on that room do — use the same `cz` (typically `-WALL_CZ` or equivalent constant) and the same `depth` (wall thickness, often `bt`).
2. **Dock width must equal the hallway's floor width.** The initial hallway is `HALL_W = 0.25` (see `assets/initial/map.ts`). Your dock segment must be 0.25 wide. If the scenario map already defines an `EXIT_DOCK_W` constant, reuse it.
3. **Dock must lie entirely within the room's wall span.** `dock.cx ± dock.width/2` must fit inside `±room.floorWidth/2`.

## Per-scenario work
For each of these scenarios, pick the terminal room (the room survivors end up in when the game ends), split that room's north wall into left-filler + centred dock + right-filler, give the dock a unique id, then:
- add `exitConnection: { roomId: '<terminal-room-id>', dockGeometryId: '<new-dock-id>' }` to the `ScenarioSpec` in `content/scenarios/<id>/scenario.ts`
- swap each end-of-game `ctx.terminate()` call in that file (currently behind a `TODO:` comment I left) for `ctx.exitScenario()`

Scenarios to fix (the hub dock on each is on a south wall, so it **cannot** be reused):
- `content/scenarios/scenario2/` — hub room is `room1`; map at `content/maps/scenario2/map.ts`. Terminal room is `room3` (`scenario2_room3`) — survivors reach it via the room2_north_wall drop in `announceFact`. `ctx.terminate()` sites to swap are in `announceFact` and `eliminateStragglers`.
- `content/scenarios/scenario3/` — hub room is `main`. Check `content/maps/scenario3/map.ts` for the actual room graph and pick whichever room is the true terminal. `ctx.terminate()` is in the `close`/end handler.
- `content/scenarios/scenario4/` — hub room is `center`. Check `content/maps/scenario4/map.ts` — scenario4 may only have one room (center) with rule/event zones, in which case the exit dock goes on center's north wall.
- `content/scenarios/prod_gates/` — terminal room is `victory` (scoped id `prod_gates_victory`). Map at `content/maps/prod_gates/map.ts`. `ctx.terminate()` site is inside the `finish()` helper (currently marked with a `TODO:` comment referencing this prompt).

## Reference (already done — do not modify)
Look at how scenario1 does it:
- `content/maps/scenario1/map.ts`: `finalNorthSegments` constant splits `final`'s north wall into `s1_fwnl` / `s1_fwne` / `s1_fwnr`. `s1_fwne` is the dock, width `EXIT_DOCK_W = 0.25`.
- `content/scenarios/scenario1/scenario.ts`: `exitConnection: { roomId: 'final', dockGeometryId: 's1_fwne' }`. Terminal handler calls `ctx.exitScenario()` instead of `ctx.terminate()`.

Follow the same structural pattern for each scenario.

## Verification
After editing each scenario + map pair:
1. Run `npx tsc --noEmit` from `react-three-capacitor/server/` — expect no new type errors. Pre-existing errors in `content/bots/scenario2/stayer/bot.ts` are unrelated and safe to ignore.
2. If you can run the server quickly (`npm run <whatever starts GameServer>`), content-load will fire `validateExitConnection` — any dock geometry error throws there with a specific message about which assertion failed.

## Things to avoid
- Don't change the existing hub dock or hub wall geometry — only add/split on the north wall of the terminal room.
- Don't rename existing geometry ids. Add new ones for the dock + fillers.
- Don't pick a non-terminal room (e.g., the spawn room) as the exit — survivors won't be able to reach it and the walk-out will hang on `buildExitScript`'s "all players in hallway" condition.
- Don't assume each map is shaped like scenario1's. scenario3 and scenario4 may have different room counts / geometry styles. Read each map first.

## Deliverable
Per scenario: one edit to `content/maps/<scenario>/map.ts` adding the split north wall, one edit to `content/scenarios/<scenario>/scenario.ts` adding `exitConnection` and swapping the terminal call. Report back the terminal-room id and dock id you chose for each, and any scenario where the terminal room wasn't obvious.
