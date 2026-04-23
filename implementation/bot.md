# Bot

## Framework files

```
react-three-capacitor/server/src/bot/
  BotTypes.ts    — types: MovementIntent, BotTarget, BotState, BotCallbackContext, BotAction, BotSpec
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
2. On `open`: reset seq counter, start the 50 ms tick interval.
3. Every tick: call `spec.nextAction(ctx, position)` → send `{ type: 'move', seq, jx, jz, dt }`.
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

The demo bot has a single phase (`walk`). Its `initialState` sets the target to Room 2 centre (x=0, z=−12.5, radius=2) immediately. `nextAction` calls `moveToward(position, target)` each tick until `isAtTarget` returns true.

No `onInstruct` or `onOtherPlayerMove` logic is needed — the scenario sends no instructions to bots and the bot does not react to other players' positions.

The door is closed when bots first connect (it opens when the 4th player connection is acknowledged). The server-authoritative walkable area stops the bot at the north wall until the door opens, at which point the next tick's movement command is accepted through the doorway.

## Demo scenario fill timer

`DemoScript.onPlayerConnect` starts a one-shot `ctx.after(10_000, …)` timer on the first connection. When it fires:

1. If `doorOpened` is already true (4 players joined naturally), do nothing.
2. Otherwise compute `needed = 4 − ctx.getPlayerIds().length` and spawn that many `DEMO_BOT` instances.
3. Each spawned bot connects to the same open demo room and fires `onPlayerConnect`, eventually reaching a count of 4 and triggering the door open via the normal path.
