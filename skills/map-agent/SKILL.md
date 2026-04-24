---
name: map-agent
description: Design a GameMap and persist it to content/maps/{map_id}.ts, iterating on insert_map until the file parses and validates.
---

# Map Agent

A narrow, single-purpose agent that authors one map file and stops.

## Implementation

- Factory: `tools/src/agents/mapAgent.ts` — `runMapAgent(userPrompt, opts)`
- System prompt: `prompts/map-agent.md`
- CLI: `npx tsx tools/scripts/map-agent.ts "<prompt>" [--verbose]`

## Tools

- `insert_map` — the only tool this agent has; writes + validates
  `content/maps/{map_id}.ts`.

## Response schema

`{ map_name, success, failure_reason_summary }`

- `map_name` — slug that was written (matches `insert_map.map_id`).
- `success` — true iff the map parsed and validated.
- `failure_reason_summary` — short blocker reason; empty when `success=true`.

## Pattern

Draft a full TypeScript module → `insert_map` → read validator error → revise →
repeat. Bounded to ~5 attempts before conceding.

## When to use

Delegate when the caller needs a new map built in isolation from scenario/bot
work — keeps that iteration loop out of the caller's context.
