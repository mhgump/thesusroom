# Bot

- Bot tick rate: 50 ms (20 Hz). The bot sends one `move` message per tick even when idle (jx=0, jz=0), keeping the server sequence counter in sync.
- Reconnect delay after unexpected disconnect: 2000 ms.
- Player-move callback threshold: 0.5 m displacement from the last-reported position.
- Player-move callback throttle: at most once per 500 ms per player.
- Bot position is tracked from `move_ack` messages only (no local physics simulation). The server-acknowledged position is used for all target calculations.
- `updateBotState` mutates the state object in place with `Object.assign`; all callbacks see the same live object. Passing `{ target: null }` clears the target.
- `nextAction` is called every tick with the latest context and the last-acknowledged position.
- The `onOtherPlayerMove` callback tracks last-reported position per player; this resets when a new `player_joined` message arrives for that player.
- NPC `player_joined` messages (those with `isNpc: true`) do not populate the other-players map; the callback is never fired for NPCs.
- Bot server URL is derived at `GameServer` construction time: `ws://localhost:PORT` for a numeric-port constructor, `ws://localhost:${process.env.PORT ?? '8080'}` for an HTTP-server constructor.
- The demo scenario starts a bot-fill timer on the first human player connection. After 10 s, if the door has not yet opened (fewer than 4 players connected), it spawns `max(0, 4 − currentPlayerCount)` bots using `DEMO_BOT`.
- Demo bot has a single phase (`walk`): it targets Room 2 centre (x=0, z=−12.5, radius=2) from the moment it connects. The server-authoritative walkable area prevents crossing the door while it is closed; once the door opens the bot walks through naturally.
