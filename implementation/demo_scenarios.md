# Demo Scenarios — Implementation

## Relevant Files

```
content/server/maps/
  scenario1.ts   — MapSpec: walkable areas (default + locked variant), vote region specs, cage geometry specs
  scenario2.ts   — MapSpec: walkable area, vote region specs
  scenario3.ts   — MapSpec: walkable area, transparent s3_rzone vote region, button specs

content/server/scenarios/
  scenario1.ts   — ScenarioSpec + Scenario1Script: wall reveal logic, 4-player cap
  scenario2.ts   — ScenarioSpec + Scenario2Script: arrival-order pairing, timed resolution
  scenario3.ts   — ScenarioSpec + Scenario3Script: button press callbacks, enableClientPress toggle

content/client/maps/
  scenario1.ts   — WorldSpec, GameSpec (vote regions + cage geometry), locked walkableVariant
  scenario2.ts   — WorldSpec, GameSpec (vote regions)
  scenario3.ts   — WorldSpec, GameSpec (button specs)
  index.ts       — Exports CURRENT_MAP resolved from CURRENT_SCENARIO_ID at load time

react-three-capacitor/server/src/
  ScenarioRegistry.ts — Assembles MapSpec + ScenarioSpec into Room instances on demand
```

## Two-File Structure Per Scenario

Each scenario is split into a server **MapSpec** (physical world: walkable area, vote regions, geometry, buttons) and a server **ScenarioSpec** (script logic: `scriptFactory`, `instructionSpecs`, `initialVisibility`). `ScenarioRegistry.getOrCreateRoom` merges these into a `Room` instance by combining `map.voteRegions`, `map.geometry`, `map.buttons`, and `scenario.instructionSpecs` into a `GameSpec`, and calling `scenario.scriptFactory()` to create a fresh script for that room.

The client has a parallel file for each scenario (`content/client/maps/`) that mirrors the server's vote region positions and button specs in a `GameSpec`. The client and server map constants must stay in sync; there is no runtime validation between them.

## Scenario 1: Find Your Circle

**Map** (`content/server/maps/scenario1.ts`): A wide single room (`VIEWPORT_W × 1.5 = 30` wide). Two `WalkableArea` variants are defined: the default (full floor) and a locked variant (`LOCKED_WALKABLE`) that restricts movement to cage interiors and the narrow corridors between them. The locked variant activates whenever all four front cage walls (`s1_w1f`–`s1_w4f`) are simultaneously visible, via `walkableVariants`. Four vote regions (`s1_v1`–`s1_v4`) sit near the north wall; twelve cage walls (left/right/front per cage) start hidden via `initialVisibility`.

**Script** (`content/server/scenarios/scenario1.ts`): `Scenario1Script.onPlayerConnect` enables all four vote regions and sends `find_instruction` to the joining player. The vote listener is registered only on the first player connect (`voteListenerRegistered` flag) to avoid duplicate listeners. `closeScenario` is called once the fourth player connects. The `onVoteChanged` callback checks whether every region has exactly one player; when that condition first holds, `wallsShown` is set (preventing re-trigger), `setGeometryVisible` reveals all twelve walls, and `vote_instruction` is sent to all players. Revealing the front walls simultaneously triggers the `walkableVariants` switch on both server and client, locking each player inside their cage.

## Scenario 2: Find Your Partner

**Map** (`content/server/maps/scenario2.ts`): A single room exactly `VIEWPORT_W × VIEWPORT_D` (one screen). Four vote regions (`s2_v1`–`s2_v4`) are placed in a 2×2 grid at ±`VIEWPORT_W/4` × ±`VIEWPORT_D/4`.

**Script** (`content/server/scenarios/scenario2.ts`): `Scenario2Script` maintains `playerOrder: string[]` to record the arrival sequence. On each connect it appends the player id, enables all vote regions, and sends `join_instruction`. When the eighth player connects, `closeScenario` is called and `startVoting` begins a two-stage `after` chain: 20 000 ms fires `warning_instruction` to all players, then after a further 10 000 ms `resolveVotes` runs.

`resolveVotes` reads `playerOrder` in consecutive pairs (indices `i`, `i+1`). For each pair it fetches their vote assignments and eliminates both if the assignments differ or if either is null. Players who disconnected before resolution are skipped (`living.includes(a)` check). Pairing is based on arrival order captured at connect time, not on any position at resolution time.

## Scenario 3: Buttons

**Map** (`content/server/maps/scenario3.ts`): A small 12×12 square room. Two button specs are defined: `btn_left` (`requiredPlayers: 1`, `enableClientPress: true`) and `btn_right` (`requiredPlayers: 2`, `enableClientPress: false`). One vote region, `s3_rzone` (transparent, zero-length label), is placed co-located with `btn_right` using the same trigger radius. Its sole purpose is proximity counting for the script; it is never rendered as a labeled circle.

**Script** (`content/server/scenarios/scenario3.ts`): `Scenario3Script` registers all listeners on the first player connect (`listenersRegistered` flag). `onButtonPress` fires a `sendNotification` for each button. The `onVoteChanged` listener for `s3_rzone` counts how many players are assigned to that region: when exactly one player is present it calls `modifyButton('btn_right', { enableClientPress: true })`, otherwise it resets to `false`. `onButtonPress` is used for the server-confirmed fire event (2-player threshold), while the vote region is used for the 1-player solo feedback toggle — the two mechanisms serve different thresholds and are independent.
