---
name: bot-agent
description: Design a BotSpec that plays a specific scenario and persist it to content/bots/{scenario_id}/{bot_id}.ts, iterating on insert_bot until it validates.
---

# Bot Agent

A narrow, single-purpose agent that authors one bot file and stops.

## Implementation

- Factory: `tools/src/agents/botAgent.ts` — `runBotAgent(userPrompt, opts)`
- System prompt: `prompts/bot-agent.md`
- CLI: `npx tsx tools/scripts/bot-agent.ts "<prompt>" [--verbose]`

## Tools

- `insert_bot` — the only tool; writes + validates
  `content/bots/{scenario_id}/{bot_id}.ts`. Scenario must already exist at
  `content/scenarios/{scenario_id}.ts`.

## Response schema

`{ bot_name, success, failure_reason_summary }`

- `bot_name` — slug that was written (matches `insert_bot.bot_id`).
- `success` — true iff the bot parsed and validated.
- `failure_reason_summary` — short blocker reason; empty when `success=true`.

## Pattern

Draft full TypeScript module exporting a `BotSpec` (phases, initialState,
`onInstructMap`, `nextCommand` per phase, optional `onChoice` /
`onOtherPlayerMove` / `onActiveVoteAssignmentChange`) → `insert_bot` → read
validator error → revise → repeat. Bounded to ~5 attempts. Key invariant:
`nextCommand` must cover every phase in `phases`.

## When to use

Delegate when the caller needs a bot written for an existing scenario. Use
multiple parallel invocations to author an ordered bot set for one run.
