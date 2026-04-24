# Handoff: scenario_map.json + per-scenario test_specs + content restructure

You are picking up where a previous agent left off. The previous work built a generic `DataBackend<K, V>` abstraction in `tools/src/_shared/backends/` with filesystem implementations for five content types. Read `~/.claude/projects/-Users-michaelgump-thesusrooms/memory/data_backend.md` before starting — it summarizes the state of that system.

**Your job has four coupled changes.** Plan them together; do not split into separate PRs.

---

## What the user asked for

1. **`content/scenario_map.json`** — a JSON array of scenario names, index = position. Example:
   ```json
   ["demo", "scenario1", "scenario2", "scenario3", "scenario4"]
   ```
   A scenario's **index** is its position in this array. Names remain the primary identifier; indices are secondary but strictly increasing.

2. **`new_scenario(name) -> index`** on the scenario backend. Assigns the next index, appends to `scenario_map.json`, returns the assigned index. Also creates the scenario's directory (next item). `delete_scenario(name)` removes from the list, **shifts remaining entries** so indices stay contiguous, and deletes the scenario's directory.

3. **Per-scenario test specs.** Each scenario gets `content/scenarios/{scenario}/test_specs.json` — a JSON array of test-spec names. `new_test_spec(scenario, name) -> index` and `delete_test_spec(scenario, name)` are analogous: append/shift in that file, create/delete the test-spec directory.

4. **Directory-per-thing layout.** Every content item gets its own directory:
   - `content/scenarios/{scenario}/` — holds the scenario script, its `test_specs.json`, and per-test-spec subdirs
   - `content/scenarios/{scenario}/test_specs/{test_spec}/` — holds the test-spec JSON
   - `content/maps/{map}/` — holds the map script
   - `content/bots/{scenario}/{bot}/` — holds the bot script
   
   Today these are flat `.ts`/`.json` files. **This is the biggest refactor in the task.**

5. **Delete `content/client/` and `content/server/`.** Only one version of each content type should remain. `content/server/` is already dead code (no runtime imports, only comment references). `content/client/` is **live** and contains a *different shape* from `content/maps/` — see "content/client vs content/maps" below. Consolidating these is non-trivial.

---

## What the previous agent confirmed

### Current content tree (verified)
```
content/
  bots/{scenario}/{bot}.ts           # two levels deep already — bots[0]: demo/demoBot.ts
  maps/{name}.ts                     # flat — used by SERVER
  maps/index.ts                      # barrel re-export
  scenarios/{name}.ts                # flat
  scenario_runs/{scenario}/{test_spec}/{index}/response.json  # already compound-key'd (previous phase)
  test_specs/{name}.json             # flat JSON; test specs are not yet per-scenario
  client/maps/{name}.ts              # LIVE — client-side map shape (different type)
  client/maps/registry.ts, index.ts
  server/maps/*.ts                   # DEAD copy — no runtime importers
  server/scenarios/*.ts              # DEAD copy — no runtime importers
  server/bots/{scenario}/…           # DEAD (may be empty)
  package.json
```

Verify again yourself before acting — the repo has been edited since this note was written. Command:
```bash
find /Users/michaelgump/thesusrooms/content -maxdepth 3 -type f
grep -rl "content/server" /Users/michaelgump/thesusrooms --include="*.ts" --include="*.tsx" | grep -v node_modules
grep -rl "content/client" /Users/michaelgump/thesusrooms --include="*.ts" --include="*.tsx" | grep -v node_modules
```

### content/client vs content/maps — read this carefully
The three "map" directories are **not duplicates**:
- `content/maps/demo.ts` exports a `GameMap` — used by the server (`react-three-capacitor/server/src/GameServer.ts` line 8) and the bot runner (`react-three-capacitor/server/scripts/run-scenario.ts`).
- `content/client/maps/demo.ts` exports a `ClientMap` — used by the browser (`react-three-capacitor/src/hud/HUD.tsx`, `src/scene/Player.tsx`, `src/scene/VoteRegions.tsx`, `src/scene/RemotePlayers.tsx`).
- `content/server/maps/demo.ts` exports a `MapSpec` — **imported by no runtime code** (only comment references). Safe to delete.

So "remove content/client, remove content/server, just one version" requires one of:
- **(A) Unify types**: merge `GameMap` and `ClientMap` into a single shape that both runtimes can consume. Non-trivial — they serve different purposes (client needs visibility/camera geometry, server needs walkable rects + physics). **Ask the user.**
- **(B) Keep two shapes but one directory**: move the client-side map into `content/maps/{name}/client.ts` and the shared/server one into `content/maps/{name}/server.ts`. Delete `content/client/maps/`. Cleaner but doesn't satisfy "just one version".
- **(C) Separate concerns via sibling files in one dir**: `content/maps/{name}/index.ts` (server), `content/maps/{name}/client.ts` (client). Similar to B.

**Do not guess — ask the user which of (A/B/C) they want before touching maps.** Scenarios and bots don't have this split, so they can proceed first.

---

## Key design decisions to confirm with the user before coding

Before you write a line of code, get explicit answers on these. Batch them into one message.

1. **What filename convention lives inside `content/scenarios/{name}/`?** Options:
   - `index.ts` (matches TS barrel convention)
   - `{name}.ts` (e.g. `content/scenarios/demo/demo.ts` — grep-friendly)
   - `scenario.ts` (fixed name, like the `test_specs.json` convention — most consistent)
   
   The previous agent recommends `scenario.ts` / `map.ts` / `bot.ts` / `spec.json` for symmetry. Same question for maps, bots, test specs.

2. **Maps consolidation** — (A), (B), or (C) above? If (A), the user needs to own the type-merge design.

3. **Cascade deletes.** When `delete_scenario("foo")` runs:
   - Do existing scenario runs under `content/scenario_runs/foo/` get deleted? (They'd otherwise be orphaned.)
   - Do bots under `content/bots/foo/` get deleted?
   
   When `delete_test_spec("foo", "bar")`:
   - Do runs under `content/scenario_runs/foo/bar/` get deleted?

4. **Scenario/test-spec name validation.** Existing regex is `[a-zA-Z0-9_-]+`. Keep it. The `_adhoc` sentinel used by `scenarioRunResult` is NOT in `scenario_map.json` and won't have a `test_specs.json` — the backend must handle this gracefully.

5. **Where does `new_scenario` / `new_test_spec` sit in the interface?** The previous agent extended `ScenarioRunBackend` with a non-generic `nextIndex()` method (see `tools/src/_shared/backends/index.ts`). Follow that pattern:
   ```ts
   interface ScenarioBackend extends DataBackend<ScenarioKey, TsSource> {
     newScenario(name: string): Promise<number>
     deleteScenario(name: string): Promise<void>
     listIndex(): Promise<string[]>  // reads scenario_map.json
   }
   interface TestSpecBackend extends DataBackend<TestSpecKey, RunScenarioSpec> {
     newTestSpec(scenario: string, name: string): Promise<number>
     deleteTestSpec(scenario: string, name: string): Promise<void>
     listIndex(scenario: string): Promise<string[]>
   }
   ```
   The user wrote "function on the generic DataBackend like `DataBackend.new_scenario(name)`" — interpret that as "extend the scenario-typed backend," matching the `nextIndex` precedent. Confirm with the user if you prefer the exact wording.

6. **Key shape change.** `TestSpecKey` is currently `string` (just the name). With per-scenario grouping it needs to become `{ scenario: string; name: string }`. This propagates to `insertRunScenarioSpec`, `addNotesToTestSpec`, `readTestSpec`, `runScenarioFromSpec`, `listContent`. **This is the second-biggest refactor after the content restructure.**

---

## Files you will have to touch

Rough inventory — verify scope before starting. File-count estimate in parens.

### New / deleted files
- `content/scenario_map.json` — create
- `content/scenarios/{name}/test_specs.json` × 5 — create
- `content/scenarios/{name}/{scenario.ts or index.ts}` × 5 — move from `content/scenarios/{name}.ts`
- `content/maps/{name}/...` × 5 — move (contingent on decision 2)
- `content/bots/{scenario}/{bot}/...` × 1 — move
- `content/test_specs/*.json` × 1 existing — move into per-scenario dirs
- `content/server/` — delete entire tree (dead)
- `content/client/` — handled per decision 2

### Backend types + impls
- `tools/src/_shared/backends/types.ts` — change `TestSpecKey` to compound
- `tools/src/_shared/backends/index.ts` — extend Backends with `ScenarioBackend` / `TestSpecBackend` interfaces
- `tools/src/_shared/backends/filesystem/scenarioBackend.ts` — rewrite: dir-per-scenario, new methods, `scenario_map.json` read/write
- `tools/src/_shared/backends/filesystem/mapBackend.ts` — rewrite: dir-per-map
- `tools/src/_shared/backends/filesystem/botBackend.ts` — rewrite: dir-per-bot (extra level)
- `tools/src/_shared/backends/filesystem/testSpecBackend.ts` — rewrite: compound key, per-scenario `test_specs.json`

### Tool impls consuming the backends
- `tools/src/insertScenario/{spec,impl}.ts` — call `newScenario(name)`, return index; use new storage path
- `tools/src/insertMap/impl.ts` — new path
- `tools/src/insertBot/impl.ts` — new path
- `tools/src/insertRunScenarioSpec/impl.ts` — compound test-spec key, call `newTestSpec`
- `tools/src/addNotesToTestSpec/{spec,impl}.ts` — compound key input (needs `scenario_id` in input schema)
- `tools/src/readTestSpec/{spec,impl}.ts` — compound key input
- `tools/src/runScenarioFromSpec/{spec,impl}.ts` — compound key input
- `tools/src/listContent/impl.ts` — new paths in output; group test specs by scenario
- New tools? `deleteScenario`, `deleteTestSpec` — ask user whether to expose these as agent-callable.

### Runtime imports that break when you move `.ts` files
- `react-three-capacitor/server/src/GameServer.ts` lines 8–17 — hardcoded imports from `content/scenarios/*.ts` and `content/maps/*.ts`
- `react-three-capacitor/server/scripts/run-scenario.ts` lines 37–41 — same
- `react-three-capacitor/src/hud/HUD.tsx`, `src/scene/{Player,VoteRegions,RemotePlayers}.tsx` — import `CURRENT_MAP` from `content/client/maps`
- `content/maps/index.ts` — barrel file; will need to move or delete depending on decision 2

After moving scenarios to `content/scenarios/{name}/scenario.ts`, those imports become `'../../../content/scenarios/demo/scenario.js'`.

### Test spec migration
`content/test_specs/demo_success_test.json` exists today at the top level. After the change, its new home is `content/scenarios/demo/test_specs/demo_success_test/spec.json` (or whatever naming convention is chosen). The file has a `last_run_artifact_ids` field referencing old UUID runs plus one new-format `demo/demo_success_test/0` — move it verbatim.

---

## Subagent strategy

The user wants you to use subagents. Here's how the previous agent split this kind of work well:

### Phase 1 — YOU (serial, sets the contract)

**Before any subagents.** In one message to the user, confirm decisions 1, 2, 3, 5 above. Write up the plan first in your turn, then execute. The cost of a wrong directory-name convention at this scale is high.

After user answers: **you personally** write:
- The new `types.ts` (`TestSpecKey` compound, and any new Key types)
- The extended `ScenarioBackend` / `TestSpecBackend` interfaces in `backends/index.ts`
- The initial `content/scenario_map.json` with the current 5 scenarios listed in some stable order
- The initial per-scenario `test_specs.json` files (`demo` has one entry: `["demo_success_test"]`; others empty `[]`)

These are the contract files every subagent depends on. Writing them yourself prevents drift.

### Phase 2 — parallel subagents (disjoint files)

Launch three agents in parallel (single message, multiple tool calls):

**Agent A: Filesystem backend rewrite** (scope: `tools/src/_shared/backends/filesystem/`)
- Brief: reshape all five filesystem backends to dir-per-thing layout. Implement `newScenario`/`deleteScenario` on scenario backend; `newTestSpec`/`deleteTestSpec` on test-spec backend. Honor `_adhoc` as a test-spec name that's not in any `test_specs.json`. Typecheck must pass.
- Hand the agent: the new `types.ts` and `backends/index.ts` you wrote; the chosen filename convention; the shift-on-delete semantics.

**Agent B: Move scenario/bot files on disk + update runtime imports** (scope: `content/scenarios/**`, `content/bots/**`, `react-three-capacitor/server/src/GameServer.ts`, `react-three-capacitor/server/scripts/run-scenario.ts`)
- Brief: move each of the 5 scenarios to their new dir; move the 1 bot; update the hardcoded imports in GameServer.ts and run-scenario.ts. Do NOT touch maps (Agent C).
- Verify by running `npx tsc --noEmit` in `react-three-capacitor/server`.

**Agent C: Maps restructure** (scope: `content/maps/**`, `content/client/maps/**`, `content/server/maps/**`, client imports)
- Only viable after user answers decision 2. Hand the agent the chosen approach (A/B/C).
- Delete `content/server/maps/*` (dead code — no importers).
- Rearrange the rest per decision.
- Update `HUD.tsx`, `Player.tsx`, `VoteRegions.tsx`, `RemotePlayers.tsx`, `GameServer.ts` imports.

Wait for all three agents. Typecheck both packages.

### Phase 3 — serial (you, because heavily interconnected)

Migrate the ~7 tool impls (`insert*`, `addNotesToTestSpec`, `readTestSpec`, `runScenarioFromSpec`, `listContent`) to the new compound `TestSpecKey` and new backend methods. Previous agent learned this is too coupled for parallel subagents — types flow across files. Do it yourself or a single focused subagent.

### Phase 4 — verify

End-to-end smoke test (write a temp `tools/scripts/smoke-restructure.ts`, run once, delete):
1. `LIST_CONTENT_TOOL` returns 5 scenarios, indices 0..4
2. `RUN_SCENARIO_FROM_SPEC_TOOL` on `demo_success_test` still completes; artifact lands at `content/scenario_runs/demo/demo_success_test/1/` (index 1 because the existing run is index 0)
3. Insert a new scenario via `INSERT_SCENARIO_TOOL`, check `scenario_map.json` grew by one, directory created
4. Delete that scenario, check map shrunk, directory gone, other scenarios' indices intact
5. Same for test specs

Clean up any test runs you created.

---

## Gotchas

- **TypeScript include paths.** `react-three-capacitor/server/tsconfig.json` has `"include": ["src", "../../content/maps", "../../content/scenarios", "../../content/bots"]`. Moving content files into subdirs means these globs still work (they're directory globs), but if you introduce non-source files (e.g. `test_specs.json`) inside `content/scenarios/`, confirm the TS compiler doesn't choke on them. `resolveJsonModule` is currently off in that tsconfig — a JSON file in an included dir is fine, it just won't be imported via TS. If the tool side wants to read these JSONs, do it via `fs.readFileSync` + `JSON.parse` through the backend, not via `import`.

- **The `_adhoc` sentinel.** `scenarioRunResult` keys use `test_spec='_adhoc'` for direct runs with no named test spec. This name will NOT appear in any `test_specs.json`. The scenario-run backend doesn't go through the test-spec backend at all, so this is fine — just don't accidentally add validation in the run path that rejects it.

- **Shift semantics.** When deleting scenario at index 2, scenarios originally at indices 3, 4 become 2, 3. This is fine for `scenario_map.json` but means any stored `scenario_index` value in the wild is now invalid. Since the run-result key uses `scenario` NAME (not index), runs are unaffected. Just be aware: **the index is a view of the file, not a stable reference**. Document this.

- **Existing `content/maps/index.ts`** is a TS barrel re-exporting each map. If you move maps into subdirectories, this barrel either needs updating or deletion. The file has no other importers per the previous grep — verify, then delete if confirmed.

- **`content/package.json` exists at the content root.** Leave it. It's there because the content directory has its own module resolution quirks.

- **The user modified `content/test_specs/demo_success_test.json` during the previous session** — its `last_run_artifact_ids` includes a mix of legacy UUIDs and one new-format id. Preserve this list verbatim when moving the file.

- **Atomicity.** `new_scenario` reads `scenario_map.json`, appends, writes back, then `put()`s the scenario source. If the tool is interrupted between read-append-write and `put()`, you get a dangling entry. For a filesystem backend used by a single agent, this is acceptable. **Do NOT add locks** — the user explicitly disfavors prophylactic complexity.

- **`listContent` tool** currently returns `{scenarios, maps, bots, test_specs}` as flat arrays. With per-scenario test specs, consider returning them grouped: `test_specs: { [scenario]: string[] }`, or keep flat but add `scenario_id` on each entry (the flat form already has `scenario_id` because `bots` does — mirror that). Ask the user.

- **Legacy `data/scenario_runs/` directory** is empty aside from `.DS_Store`. The previous agent left it. You can `rm -rf /Users/michaelgump/thesusrooms/data/scenario_runs` if the user confirms — but don't delete proactively.

---

## Execution checklist (suggested order)

1. [ ] Ask user decisions 1–6 in one batched message.
2. [ ] Write `types.ts` (compound `TestSpecKey`, new interfaces in `backends/index.ts`).
3. [ ] Write `content/scenario_map.json` and initial `test_specs.json` files at new locations (or staging).
4. [ ] Dispatch Agents A + B + C in parallel.
5. [ ] Review each agent's diff; run `tsc --noEmit` on both packages.
6. [ ] Serially migrate tool impls for the new compound `TestSpecKey`.
7. [ ] Smoke test end-to-end.
8. [ ] Update `~/.claude/projects/.../memory/data_backend.md` to reflect the new layout, new methods, and the scenario_map / per-scenario test_specs invariants.
9. [ ] Offer to delete `data/scenario_runs/` (empty) if the user wants.

---

## Anti-patterns to avoid (from prior sessions)

- **Do not pass this task to one subagent in one shot.** It's too wide. Parallel disjoint subagents + serial integration, as above.
- **Do not add backwards-compatibility aliases** (`RunScenarioOutput = ScenarioRunResult` etc.). The previous agent added one and had to rip it out on review. Just change the types.
- **Do not duplicate types across packages without a note.** The previous agent duplicated `ScenarioRunResult` in `run-scenario.ts` (server package) and `tools/src/runScenario/spec.ts` (tools package); they're kept in sync manually because cross-package imports aren't worth the build-order pain. If you add new shared types, follow the same pattern and call it out in comments.
- **Do not write subagent briefs as terse commands.** The previous agent's successful briefs were 200–350 words, named every file, spelled out the contract, and told the agent what NOT to touch. Follow that template.
- **Do not commit anything.** User hasn't asked for commits and this project has custom rules.
