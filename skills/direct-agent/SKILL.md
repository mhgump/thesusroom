---
name: direct-agent
description: Drive a gameplay goal end-to-end by alternating edits (map/scenario/bot) and runs (scenario execution + log inspection) until the goal is met or declared unreachable.
---

# Direct Modification Agent

The top-level orchestrator. Composes the other four agents plus low-level
primitives.

## Implementation

- Factory: `tools/src/agents/directAgent.ts` — `runDirectAgent(userPrompt, opts)`
- System prompt: `prompts/direct-agent.md`
- CLI: `npx tsx tools/scripts/direct-agent.ts "<prompt>" [--verbose]`
- Default `maxIterations`: 60.

## Tools

Sub-agents (chunky, self-contained sub-tasks):

- `map_agent`, `scenario_agent`, `bot_agent`, `run_scenario_agent`.

Low-level primitives (small surgical changes):

- `insert_map`, `insert_scenario`, `insert_bot`.
- `run_scenario_with_bots`, `get_scenario_logs`, `get_bot_logs`.

Discovery + inspection:

- `list_content` — enumerate existing scenarios / maps / bots / test specs.
- `read_test_spec` — pull back the full content of any test spec (notes,
  `last_run_artifact_ids`).

## Response schema

`{ goal_achieved, summary, failure_reason_summary, iterations_used }`

## Pattern

Decompose goal → `list_content` to avoid duplication → alternate edit-and-run
cycles, preferring sub-agents for multi-call work and primitives for one-line
changes → after each `run_scenario_agent` call, `read_test_spec` for notes and
dig into `last_run_artifact_ids` as needed → stop at success, unreachability,
or ~10 unproductive iterations.

## When to use

This is the entry point when the caller hands over a goal rather than a
specific sub-task. Reference every sub-agent attempt by `test_spec_name` in
the final summary.
