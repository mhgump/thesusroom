# Bot

## Framework files

```
react-three-capacitor/server/src/bot/
  BotTypes.ts    — types: MovementIntent, BotTarget, BotState, BotCallbackContext, BotCommand, BotSpec
                   helpers: isAtTarget(), moveToward()
  BotClient.ts   — manages one bot: WebSocket connection, tick loop, callback dispatch
  BotManager.ts  — spawns and tracks BotClient instances; holds the server URL
```

Content bots live alongside the scenarios they play:

```
content/server/bots/
  demo/
    demoBot.ts   — BotSpec for the demo scenario
```

## Threading model

Node.js is single-threaded. Each bot is managed by a `setInterval` tick and WebSocket event callbacks — no threads. The "thread" in the spec means a logically independent event-driven loop.

## BotClient lifecycle

1. `start()` → `connect()` opens `ws://<serverUrl>/<scenarioId>`.
2. On `open`: reset `clientPredictiveTick` to 0, start the 50 ms tick interval.
3. Every tick: call `spec.nextCommand(ctx, position)` → send `{ type: 'move', tick: clientPredictiveTick, inputs: [{ jx, jz, dt }] }`, then increment `clientPredictiveTick`.
4. On `move_ack`: update `this.position` from the server-authoritative values.
5. On `player_update` for a known player: update position map; conditionally fire `onOtherPlayerMove`.
6. On `player_left` for the bot's own id: call `stop()` (eliminates without reconnect).
7. On socket `close` (other reason): stop tick, schedule reconnect after 2 s.

## Context object

`makeContext()` returns a fresh `BotCallbackContext` on every call. The `state` property is a getter that returns `this.state` directly, so mutations via `updateBotState` (which calls `Object.assign(this.state, updates)`) are immediately visible to any other holder of the context.

## Spawning bots from a scenario

`GameScriptContext.spawnBot(spec)` passes through:

```
GameScriptManager.spawnBotFn
  → Room constructor spawnBotFn parameter
  → ScenarioRegistry: (spec) => this.spawnBotFn!(scenarioId, spec)
  → BotManager.spawnBot(scenarioId, spec)
  → new BotClient(serverUrl, scenarioId, spec).start()
```

`BotManager` is constructed in `GameServer` with the derived server URL and passed to `ScenarioRegistry` via its constructor. `ScenarioRegistry` partially applies the scenario ID so each room's spawn function is pre-bound to its own scenario.

## Demo bot

The demo bot has a single phase (`walk`). Its `initialState.target` is `null` — the bot walks nowhere after connecting. When the scenario script sends the `rule_move` instruction, `onInstructMap.rule_move` fires and calls `ctx.updateBotState({ target: R2_TARGET })`, setting the target to Room 2 centre (`x=0, z=-12.5, radius=2`). From that point on `nextCommand` returns `moveToward(position, target)` each tick until the bot arrives.

`onOtherPlayerMove` and `onActiveVoteAssignmentChange` are wired but no-ops — the demo bot does not react to either.

The door is closed when bots first connect (it opens once the fourth player connects). The server-authoritative walkable area stops the bot at the doorway until the door opens; once it opens the next tick's movement command is accepted through.

## Demo scenario fill timer

`DemoScript.onPlayerConnect` starts a one-shot `ctx.after(2_000, …)` timer on the first connection (`BOT_FILL_DELAY_MS = 2_000` in `content/server/scenarios/demo.ts`). When it fires:

1. If `doorOpened` is already true (four players joined naturally), do nothing.
2. Otherwise compute `needed = 4 − ctx.getPlayerIds().length` and spawn that many `DEMO_BOT` instances.
3. Each spawned bot connects to the same open demo room and fires `onPlayerConnect`, eventually reaching a count of 4 and triggering the door-open path.
