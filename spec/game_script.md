# Game Script — Spec

- At most one game script runs per world at a time.
- A game script maintains internal state across its lifetime.
- When a human player connects to the room, the game script's `onPlayerConnect` callback fires with that player's id.
- A game script can send an instruction message to any specific player; the player receives a text string derived from a named instruction spec. Instruction messages are displayed to the player using the Rule UX as a single `COMMAND`-labelled rule card.
- A game script can enable or disable named vote regions; only enabled regions count for position-based vote tracking.
- A vote region is a circular area in world space with a colour and label. A vote region spec is valid only when the circle is fully contained within a room floor.
- The server tracks which vote region (if any) each player is currently inside, based on their position after each move.
- When a player's vote region assignment changes, any callbacks registered for that region fire with the complete current assignment map (player id → region id or null).
- A game script can register a one-shot callback to fire after a specified duration in milliseconds; a cancel function is returned that prevents the callback if called before it fires.
- A game script can eliminate any player directly, removing them from the game immediately without going through the HP system.
- `ToggleVoteRegionOn` and `ToggleVoteRegionOff` events activate and deactivate a named vote region.
- An `InstructionEvent` targets a specific player and delivers a text instruction to that player's client.
- A `GameSpec` defines the world's instruction specs and vote region specs; it is separate from the world geometry spec.
