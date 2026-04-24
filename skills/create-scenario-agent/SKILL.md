---
name: create-scenario-agent
description: End-to-end scenario builder — takes a natural-language brief and produces a validated plan, first-pass map/scenario/bots, and one passing test spec per outcome, with regression checks against previously-passing outcomes.
---

# Create-Scenario Agent

Top-level life-cycle driver. Unlike the other agents, this one is a
**deterministic TypeScript orchestrator**, not a model loop. It composes the
LLM-driven sub-agents as its primitives:

```
brief
  → scenario-plan-agent           (plan JSON)
  → map-agent                     (first-pass map)
  → bot-agent × N personas        (parallel)
  → scenario-agent                (first-pass scenario script)
  → for each outcome:
      snapshot → direct-agent → regression-check → rollback-or-keep
```

## Implementation

- Factory: `tools/src/agents/createScenarioAgent.ts` — `runCreateScenarioAgent(brief, opts)`
- System prompt: there is none. This agent is pure TypeScript; its behavior
  lives in the runner, not a prompt. `SKILL.md` is for human readers.
- CLI: `npx tsx tools/scripts/create-scenario-agent.ts "<brief>" [--verbose]`
- Default `maxEditFailures`: 5 (global across outcomes).

## Stages

1. **Plan.** `runScenarioPlanAgent(brief)`. Bail on `success=false`. Reads the
   persisted plan JSON back to get `bot_personas[]` and `outcomes[]`.
2. **First-pass content.** Author `content/maps/{plan_id}/map.ts`, then all
   `content/bots/{plan_id}/{persona}/bot.ts` files in parallel, then
   `content/scenarios/{plan_id}/scenario.ts`. Bail on any sub-agent returning
   `success=false`.
3. **Per-outcome loop.** For each outcome in plan order:
   - Snapshot `content/maps/{plan_id}/`, `content/scenarios/{plan_id}/`,
     `content/bots/{plan_id}/` to a tmp dir.
   - Run `direct-agent` with a fixed `test_spec_name = outcome_{i}` brief.
   - If `goal_achieved=false` → rollback snapshot, `num_edit_failures++`,
     retry the same outcome (or bail if cap exceeded).
   - Regression-check every previously-passing spec via
     `run_scenario_from_spec`. Any regression → rollback + retry.
   - Clean pass → push to `passing_specs`, drop snapshot, continue.
4. **Report.** Return `{ goal_achieved, plan_name, scenario_id, passing_specs,
   failed_outcomes, num_edit_failures, failure_reason_summary }`.

## Conventions the orchestrator enforces

| Thing | Convention |
|---|---|
| `scenario_id` | same slug as `plan_id` |
| `map_id` | same slug as `plan_id` |
| Bot path | `content/bots/{scenario_id}/{persona_name}/bot.ts` |
| Bot export | `{PERSONA_NAME_UPPER}_BOT` (non-alphanum → `_`) |
| Test spec name | `outcome_{i}` (zero-based, in plan order) |

These are hard-coded in the outcome brief so the direct-agent cannot drift.

## Response schema

```ts
{
  goal_achieved: boolean       // true iff every outcome has a passing spec
  plan_name: string            // = plan_id
  scenario_id: string          // = plan_id (empty if plan failed)
  passing_specs: string[]      // test_spec_names confirmed passing
  failed_outcomes: Array<{
    test_spec_name: string
    personas: { name, count }[]
    expected_survivors: number
    failure_reason_summary: string
  }>
  num_edit_failures: number    // global, capped at maxEditFailures
  failure_reason_summary: string
}
```

## Snapshot / rollback

Implemented in `tools/src/_shared/snapshotScenarioTree.ts`. Snapshots the
scenario dir (incl. `test_specs/`), the map dir, and the scenario's bot tree
to a `mkdtemp` directory. Does **not** snapshot `content/scenario_plans/` (the
plan is fixed) or `content/scenario_runs/` (append-only run artifacts).
Restore is delete-then-copy: any new files created during the failed attempt
are removed before the backup is copied back.

## When to use

When the caller hands over a natural-language gameplay brief and wants the
whole scenario built + validated end-to-end. If the caller already has a
specific sub-task (write a bot, fix a test-spec run, etc.) use the
corresponding focused agent instead.
