---
name: run-scenario-agent
description: Run a scenario with a chosen bot set, judge whether the prompt's goal was met, and persist the reasoning as a test spec at content/scenarios/{scenario_id}/test_specs/{test_spec_name}/spec.json.
---

# Run-Scenario Agent

Executes and evaluates — does not modify map/scenario/bot content.

## Implementation

- Factory: `tools/src/agents/runScenarioAgent.ts` — `runRunScenarioAgent(userPrompt, opts)`
- System prompt: `prompts/run-scenario-agent.md`
- CLI: `npx tsx tools/scripts/run-scenario-agent.ts "<prompt>" [--verbose]`

## Tools

- `list_content` — enumerate scenarios / maps / bots / prior test specs.
- `insert_run_scenario_spec` — create/replace a test spec (validates referenced files).
- `run_scenario_from_spec` — run the scenario; returns `run_artifact_id`.
- `read_test_spec` — read spec back (to see prior notes before appending).
- `add_notes_to_test_spec` — **the only way** reasoning is persisted; notes are append-only.
- `get_scenario_logs`, `get_bot_logs` — inspect a `run_artifact_id`.

## Response schema

`{ scenario_id, test_spec_name, success }`

The spec at `content/scenarios/{scenario_id}/test_specs/{test_spec_name}/spec.json`
is the durable record — the return value is only a pointer to it.

## Pattern

Pick unique `test_spec_name` → `insert_run_scenario_spec` → `run_scenario_from_spec`
→ inspect `complete` / `survivors` / logs → `add_notes_to_test_spec` **exactly
once** with `author: "run-scenario-agent"` → return pointer. Cap at two runs per
invocation.

## When to use

Delegate for running a specific configuration and recording a verdict. The
test-spec notes trail is the durable evidence of what was tried and why.
