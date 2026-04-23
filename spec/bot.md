# Bot

- A bot participates in a game exactly like a human player: it has a player ID, a color, a position, and sends move messages.
- The server cannot distinguish a bot connection from a human connection.
- Each bot is driven by a spec that defines its behavior through callbacks and a movement function.
- A bot maintains a target location it commits to reaching; the target may be a circular region (center + radius) or a square region (center + width/height).
- A bot's movement intent is declared as an enum; the only current intent is COMMIT, meaning the bot always moves toward its target.
- When an instruction arrives, the bot's instruction callback is invoked; the bot may update its state in response.
- When another player moves more than a threshold distance from their last reported position, and enough time has elapsed since the last report for that player, the bot's player-move callback is invoked with the previous and current positions.
- All callbacks share access to the bot's mutable state, which includes at minimum: target, intent, and phase.
- A bot spec declares a list of named phases; these names identify the stages the bot moves through.
- A scenario script can spawn a bot by calling `spawnBot` on the game script context; the bot joins the same scenario as the running room.
- Bots are allowed to connect to closed rooms because bot connection is controlled by the scenario script, not the open-room registry.
- A bot stops when it is eliminated (receives its own player-left message) and does not reconnect.
- If the connection drops for any other reason, the bot reconnects automatically.
