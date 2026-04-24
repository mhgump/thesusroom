# Bot

- Bot tick rate: 50 ms (20 Hz) — matches the server simulation tick. The bot sends one `move` message per tick even when idle (jx=0, jz=0) so its `clientPredictiveTick` stream is contiguous and never lets the server tick's pending-move buffer run empty for this player.
- Reconnect delay after unexpected disconnect: 2000 ms.
- Player-move callback threshold: 0.5 m displacement from the last-reported position.
- Player-move callback throttle: at most once per 500 ms per player.
- Bot position is tracked from `move_ack` messages only (no local physics simulation). The server-acknowledged position is used for all target calculations.
- `updateBotState` mutates the state object in place with `Object.assign`; all callbacks see the same live object. Passing `{ target: null }` clears the target.
- `nextAction` is called every tick with the latest context and the last-acknowledged position.
- The `onOtherPlayerMove` callback tracks last-reported position per player; this resets when a new `player_joined` message arrives for that player.
- NPC `player_joined` messages (those with `isNpc: true`) do not populate the other-players map; the callback is never fired for NPCs.
- Bot server URL is derived at `GameServer` construction time: `ws://localhost:PORT` for a numeric-port constructor, `ws://localhost:${process.env.PORT ?? '8080'}` for an HTTP-server constructor.
- The demo scenario starts a bot-fill timer on the first human player connection. After `BOT_FILL_DELAY_MS = 2_000` ms, if the door has not yet opened (fewer than 4 players connected), it spawns `max(0, 4 − currentPlayerCount)` bots using `DEMO_BOT`.
- Demo bot starts with `target: null` and walks nowhere. Only once the scenario sends the `rule_move` instruction does its `onInstructMap.rule_move` handler set the target to Room 2 centre (`x=0, z=-12.5, radius=2`). Before then the bot is idle at its spawn position.
