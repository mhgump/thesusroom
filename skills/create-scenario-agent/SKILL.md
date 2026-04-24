---
name: create-scenario-agent
description: End-to-end scenario builder. Drives plan → map → bots → scenario → per-outcome validation → hero-POV recording. LLM-driven orchestrator that reuses existing assets when the brief names an existing slug.
---

# Create-Scenario Agent

Top-level LLM orchestrator for a scenario's full life-cycle. Unlike the
other agents it is granted the full tool surface — every sub-agent as a
tool, plus the full set of primitives, plus `load_scenario_context` for
fast context recovery on an existing scenario. The agent itself decides
when each sub-agent fires and when to reuse existing content.

## Implementation

- Factory: `tools/src/agents/createScenarioAgent.ts` — `runCreateScenarioAgent(brief, opts)`.
- System prompt: `skills/create-scenario-agent/prompt.md`.
- CLI: `npx tsx tools/scripts/create-scenario-agent.ts "<brief>" [--verbose]`.

## Tool surface

Sub-agents (all wrapped as tools):
- `scenario_plan_agent`, `map_agent`, `scenario_agent`, `bot_agent`
- `direct_agent` — per-outcome iteration driver
- `run_scenario_agent` — one-shot run + note-taking

Context loading:
- `load_scenario_context(scenario_id)` — plan JSON + map source + scenario
  source + every bot source + every test spec in one call

Primitives:
- `insert_scenario_plan`, `insert_map`, `insert_scenario`, `insert_bot`
- `insert_run_scenario_spec`, `run_scenario_from_spec`,
  `run_scenario_with_bots`, `add_notes_to_test_spec`, `read_test_spec`,
  `list_content`, `get_scenario_logs`, `get_bot_logs`

## Flow the prompt enforces

1. Call `load_scenario_context` with the best slug guess.
2. Reuse anything that already exists; regenerate only missing pieces.
3. Walk plan outcomes; for each, brief `direct_agent` to produce a
   passing test spec named `outcome_{i}`, including a `hero_index`.
4. Regression-check previous outcomes after each pass.
5. Re-run every passing spec with `record_video_bot_index=hero_index` to
   produce a hero-POV recording (without re-inserting the spec).
6. Append validation notes along the way.
7. Call `record_json_task_response` with the final result.

## Response schema

```ts
{
  goal_achieved: boolean
  plan_name: string
  scenario_id: string
  passing_specs: string[]
  failed_outcomes: { test_spec_name, personas, expected_survivors, failure_reason_summary }[]
  num_edit_failures: number
  failure_reason_summary: string
  log_dir: string             // added by the framework wrapper
}
```

## Pre-flight handled by the wrapper (not the LLM)

Before the LLM loop starts, `runCreateScenarioAgent` runs:
- `gcloud auth print-access-token` probe (fast-fails with a clear message
  if the caller isn't authenticated for Vertex AI).
- `withRunLog('create-scenario', ...)` wrapper so the whole run plus every
  sub-agent invocation lands in `logs/`.

## When to use

When the caller hands over a natural-language gameplay brief and wants the
whole scenario built + validated + recorded. Pair a specific sub-task
(write one bot, fix one spec) with the corresponding focused agent instead.
