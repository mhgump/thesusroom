# Hand-off: implement the `create-scenario` agent

You are taking over a session. The user wants a new top-level agent,
`create-scenario`, that drives a scenario's full life-cycle: natural-language
brief → validated plan → first-pass map/scenario/bots → one passing test spec
per outcome, with regression checks against previously-passing outcomes.

This doc is your operational hand-off. It captures what I learned about the
codebase, the conventions and gotchas, and the exact plan the user already
approved at the high level. Read it end-to-end before editing.

---

## Project orientation

Thesusrooms is a multiplayer room game built as a suite of **content** (maps,
scenarios, bots) exercised by **agents** (LLM-driven authors + runners) and
validated via **test specs** (recorded runs + notes).

### Content tree

```
content/
  scenario_plans/{plan_id}.json          # Design-time blueprint (plan agent)
  maps/{map_id}/map.ts                   # GameMap — rooms, geometry, connections
  scenarios/{scenario_id}/
    scenario.ts                          # ScenarioSpec — script + timeout + visibility
    test_specs/{name}/spec.json          # One attempt's definition + notes trail
  bots/{scenario_id}/{bot_id}/bot.ts     # BotSpec — ties to a scenario
  scenario_runs/{scenario}/{spec}/{n}/   # Run artifacts: response.json, logs, video
```

A scenario is always tied to one map (by slug) and any number of bots (scoped
by scenario_id). Bots can be per-persona (e.g. `mover/bot.ts`,
`stayer/bot.ts`).

### Agents (all under `tools/src/agents/*Agent.ts`)

Each is a model loop driven by `runAgent(...)` in
`tools/src/_shared/agentLoop.js`, reads its system prompt from
`skills/{name}/` via `loadSkill()`, and exposes an exported
`run{Name}Agent(prompt, opts)` function plus a CLI wrapper in
`tools/scripts/{name}-agent.ts`.

| Agent | Sole-purpose tool | Output |
| --- | --- | --- |
| `scenario-plan-agent` | `insert_scenario_plan` | `{ plan_name, success, failure_reason_summary }` |
| `map-agent` | `insert_map` | `{ map_name, success, failure_reason_summary }` |
| `scenario-agent` | `insert_scenario` | `{ scenario_name, success, failure_reason_summary }` |
| `bot-agent` | `insert_bot` | `{ bot_name, success, failure_reason_summary }` |
| `run-scenario-agent` | `insert_run_scenario_spec`, `run_scenario_from_spec`, `add_notes_to_test_spec`, `read_test_spec`, `get_scenario_logs`, `get_bot_logs`, `list_content` | `{ scenario_id, test_spec_name, success }` |
| `direct-agent` | all of the above as tools | `{ goal_achieved, summary, failure_reason_summary, iterations_used }` |

Each agent also has a `*_AGENT_TOOL` wrapper so higher-level agents can call it
as a tool (see `tools/src/{name}AgentTool/`).

### The runner → server → response.json pipeline

`run_scenario_from_spec` → `run_scenario_with_bots` → `run_scenario` →
`react-three-capacitor/server/scripts/run-scenario.ts` (registers the run with
the running server, connects CLI bots, waits for termination, writes
`content/scenario_runs/{scenario}/{spec}/{n}/response.json`).

Key response.json fields:

```jsonc
{
  "config": { "effective_timeout_ms": 7500, ... },
  "logs": "...",            // merged cli-bot + scenario-bot logs
  "server_logs": "...",     // server-side logs
  "termination_metadata": {
    "terminated_by": "scenario" | "timeout",
    "final_state": {
      "survivor_count": 4,
      "survivor_player_ids": ["..."]
    }
  }
}
```

**`final_state` is the authoritative survivor signal.** It is captured from
the Room's living-player map at finalize time by
`ScenarioRunRegistry.finalize()` in
`react-three-capacitor/server/src/scenarioRun/ScenarioRunRegistry.ts`. Do NOT
infer survivors from log presence/absence.

`run_scenario_with_bots` surfaces `termination_metadata.final_state.survivor_count`
as its returned `survivors` field. That is what every caller should use.

### Sim-time compression

The run-scenario server uses `tickRateHz=240` (12× canonical 20Hz), so a
scenario's `timeoutMs: 15000` shows up as `effective_timeout_ms: 1250` in
wall-clock ms. Don't be alarmed — sim time still runs at the scenario's
declared rate internally. All your scenario-side timers are sim-ms; the
harness converts on your behalf.

---

## Gotchas that already burned us this session

### bot-agent shape-validator is insufficient

`insert_bot` only checks the top-level shape of the exported BotSpec. The
following validate cleanly but fail at runtime. The shipped SKILL.md + prompt
now warn about them; trust but verify each new bot before accepting it:

1. **State mutation.** `BotCallbackContext.state` is `readonly`. Writing
   `ctx.state.target = ...` is silently dropped. Use `ctx.updateBotState({ target })`.
2. **`nextCommand` signature.** It is `(ctx, position)`. `BotCallbackContext`
   has no `.position` property. Use the second arg (or `ctx.getPosition()`).
3. **`autoReady` is not a BotSpec field.** It is a `BotClient` constructor
   option (defaults to true). Putting it on the spec is a silent no-op.

Canonical reference: `react-three-capacitor/server/src/bot/BotTypes.ts`.

### scenario-agent: terminate on every terminal path

A scenario that leaves a dead-end branch without `ctx.terminate()` silently
waits for `timeoutMs`, which shows up as `complete: false` in the
run-scenario-agent's verdict. Example from this session:
`eliminateStragglers` would eliminate every player in the 0-survivor outcome
and then fall through — no terminate → 15-second timeout. Fix was to add an
early `if (ctx.getPlayerIds().length === 0) { ctx.terminate(); return }`.

The scenario-agent SKILL.md + prompt were updated to require walking every
terminal branch. For the create-scenario orchestrator, a regression check on
`complete` enforces this at test time.

### scenario-plan-agent: 0-survivor outcomes require a clean terminate path

The plan agent's `scenario_sketch` must mention the 0-survivor terminate
branch when an outcome with `expected_survivors: 0` is listed — otherwise
the downstream scenario-agent is likely to forget it. This is now called out
in the plan-agent guidelines.

---

## The job (as agreed with the user)

Build `create-scenario` as a **deterministic TS orchestrator** (not a model
loop). It calls the existing LLM-driven sub-agents as its primitives.

### Stages

**Stage 1 — Plan.** `await runScenarioPlanAgent(brief)`. If `success=false`,
return `{ goal_achieved: false, failure_reason_summary: ... }`.

Read `content/scenario_plans/{plan_id}.json` back to get `bot_personas[]`
and `outcomes[]` (these are not in the plan-agent's response object).

**Stage 2 — First-pass content.** Order matters because `scenario.ts` *may*
import a bot spec for a room-fill path, and `insert_scenario` does a dynamic
import — so any imported bot file must exist before the scenario is written.

1. `runMapAgent` with a brief seeded by `plan.scenario_sketch`.
2. `runBotAgent` once per persona, **in parallel** — they don't depend on each
   other. File convention: `content/bots/{scenario_id}/{persona_name}/bot.ts`,
   export name `{PERSONA_NAME}_BOT`.
3. `runScenarioAgent`. Fill bots are **optional**: some scenarios need one
   (e.g. a room that must reach N players before a door opens), many don't.
   Pass the list of authored bots (paths + export names) in the brief so the
   scenario-agent can import one *if* its reading of `scenario_sketch`
   requires fill. Do not mandate a fill choice from the orchestrator.

Bail on any sub-agent returning `success=false`.

**Stage 3 — Per-outcome loop.**

Shared state:
```ts
let passing_specs: string[] = []      // test_spec_names confirmed passing
let num_edit_failures = 0             // GLOBAL across outcomes; cap = 5
```

For each outcome in plan order (outer loop):

  - **Snapshot** `content/maps/{id}/`, `content/scenarios/{id}/` (including
    test_specs), `content/bots/{id}/` into a tmp dir. (Do NOT snapshot
    `content/scenario_plans/` — the plan is fixed — or
    `content/scenario_runs/` — append-only run artifacts.)

  - **Attempt** (inner retry):
    - Build a direct-agent brief: "Author one test spec named
      `{outcome_name}` for scenario `{scenario_id}`. Use personas
      `{personas[]}` with counts `{counts[]}`. Expected: `complete=true` and
      `survivor_count == {expected_survivors}`. You may edit any bot/scenario
      file. Stop when the spec's run meets the assertion."
    - Append accumulated failure context if `num_edit_failures > 0` (the last
      failure's summary — bounded to 1-2 so prompts don't balloon).
    - `await runDirectAgent(brief)`.
    - If `goal_achieved=false` → **rollback**: restore the snapshot.
      `num_edit_failures++`. If `num_edit_failures > 5`, break out with
      failure. Else retry this outcome.

  - **Regression check** (after direct-agent success):
    - For every `spec` in `passing_specs`: `await runScenarioFromSpec(spec)`.
      Fail if `terminated_by != 'scenario'` or
      `final_state.survivor_count != plan_expected[spec]`.
    - Any regression → **rollback**: restore the snapshot.
      `num_edit_failures++`. If `num_edit_failures > 5`, break out.
      Else retry this outcome with regression evidence in the brief.

  - Clean pass → `passing_specs.push(outcome.test_spec_name)`, drop snapshot,
    continue.

**Stage 4 — Report.** Return `{ plan_name, passing_specs, failed_outcomes,
num_edit_failures, goal_achieved }` where `goal_achieved` is true iff every
outcome has a passing spec.

### Implementation notes

- **Direct-agent needs a back-reference to the spec it produced.** Its current
  response is `{ goal_achieved, summary, failure_reason_summary,
  iterations_used }` — no pointer to the test_spec. Extend
  `DirectAgentResponse` with `test_spec_name: string | null`, update
  `DIRECT_RESPONSE_SPEC`, update `skills/direct-agent/prompt.md` to require
  the agent populates it.

- **Snapshot/restore** is pure filesystem. Use `fs.cpSync(src, dst, {
  recursive: true })` and delete-then-copy back on restore. Keep it in
  `tools/src/_shared/snapshotScenarioTree.ts`.

- **Predictable test-spec names.** Have the orchestrator pass a fixed
  `test_spec_name` per outcome (e.g. `outcome_0`, `outcome_1`, or derived
  from the persona composition). The direct-agent's brief demands that name.
  Do NOT rely on scanning the test_specs dir for new entries — that's racy
  and fragile.

- **Retries should bound prompt growth.** On retry, include at most the last
  1–2 failure summaries plus the original outcome brief.

- **CLI wrapper**: `tools/scripts/create-scenario-agent.ts`. Since this isn't
  a model loop, don't use `_runAgentCli` (it assumes the agentLoop shape).
  Just call `runCreateScenarioAgent(prompt, opts)` directly and print the
  result.

- **Register the runner in `tools/src/index.ts`**. No `ALL_TOOLS` entry needed
  unless you want to expose it as a tool to other agents — the user hasn't
  asked for that yet.

### Decisions already agreed

- `num_edit_failures` is **global** across outcomes, cap 5.
- Retries pass **accumulated** failure evidence to direct-agent (bounded).
- Stage 2 does **not** pick a fill bot. Not every scenario uses one; the
  scenario-agent decides based on `scenario_sketch`. The orchestrator just
  hands it the list of authored bots.
- `create_scenario_prompt.md` (this file) lives at the repo root per the
  user's literal request. Skill dir lives at `skills/create-scenario-agent/`.

### What to verify before returning

- End-to-end smoke: feed a short brief (reuse or adapt the session's
  scenario2 brief), let it run, confirm one passing test spec per outcome.
- Regression check actually fires. Manual test: after first success, edit a
  file inline to break outcome 0, kick off outcome 1, confirm it detects +
  reverts.
- `num_edit_failures > 5` halt path works.

Good luck.
