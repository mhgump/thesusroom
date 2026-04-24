---
name: scenario-agent
description: Design a ScenarioSpec tied to an existing map and persist it to content/scenarios/{scenario_id}.ts, iterating on insert_scenario until it validates.
---

# Scenario Agent

A narrow, single-purpose agent that authors one scenario file and stops.

## Implementation

- Factory: `tools/src/agents/scenarioAgent.ts` — `runScenarioAgent(userPrompt, opts)`
- System prompt: `prompts/scenario-agent.md`
- CLI: `npx tsx tools/scripts/scenario-agent.ts "<prompt>" [--verbose]`

## Tools

- `insert_scenario` — the only tool; writes + validates
  `content/scenarios/{scenario_id}.ts`. Requires `map_id`, and the referenced
  `content/maps/{map_id}.ts` must already exist.

## Response schema

`{ scenario_name, success, failure_reason_summary }`

- `scenario_name` — slug that was written (matches `insert_scenario.scenario_id`).
- `success` — true iff the scenario parsed and validated.
- `failure_reason_summary` — short blocker reason; empty when `success=true`.

## Pattern

Draft full TypeScript module exporting a `ScenarioSpec` (`scriptFactory`,
`timeoutMs`, `onTerminate`, optional initial visibility) → `insert_scenario`
→ read validator error → revise → repeat. Bounded to ~5 attempts.

## When to use

Delegate when the caller needs a scenario authored against an existing map,
without also running it. Pair with `run-scenario-agent` for validation.
