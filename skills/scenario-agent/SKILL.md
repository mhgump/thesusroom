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

## Termination discipline (the validator does NOT catch this)

Every terminal path in the script must call `ctx.terminate()` — including
degenerate outcomes like "all players eliminated" or "no-op majority."
Otherwise the scenario silently hangs until `timeoutMs` expires and the test
harness reports `complete: false`, which the run-scenario-agent flags as a
scenario authoring bug.

Example of the pitfall: a handler that eliminates stragglers and then bails
out without checking `ctx.getPlayerIds().length === 0` — the scenario will
time out whenever every player is eliminated. Fix pattern:

```ts
eliminateStragglers(state, ctx) {
  for (const pid of ctx.getPlayerIds()) {
    if (!state.inRoom2[pid]) ctx.eliminatePlayer(pid)
  }
  if (ctx.getPlayerIds().length === 0) {
    ctx.terminate()
    return
  }
  // ...continue to the success-path checks...
}
```

Walk every terminal branch of the script and confirm each one reaches
`ctx.terminate()`.

## When to use

Delegate when the caller needs a scenario authored against an existing map,
without also running it. Pair with `run-scenario-agent` for validation.
