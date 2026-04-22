# Game Script — Spec

- At most one game script runs per world at a time.
- A game script's lifetime is exactly the lifetime of its room; a new room gets a fresh script with no prior state.
- When a human player connects to the room, the game script's `onPlayerConnect` callback fires with that player's id.
- A game script can send an instruction message to any specific player; the player receives a text string derived from a named instruction spec. Instruction messages are displayed to the player using the Rule UX as a single `COMMAND`-labelled rule card.
- A game script can enable or disable named vote regions; only enabled regions count for position-based vote tracking.
- A vote region is a circular area in world space with a colour and label. A vote region spec is valid only when the circle is fully contained within a room floor.
- The server tracks which vote region (if any) each player is currently inside, based on their position after each move.
- When a player's vote region assignment changes, any callbacks registered for that region fire with the complete current assignment map (player id → region id or null).
- A game script can register a one-shot callback to fire after a specified duration in milliseconds; a cancel function is returned that prevents the callback if called before it fires.
- A game script can eliminate any player directly, removing them from the game immediately without going through the HP system.
- A game script can close the scenario, removing it from the open registry so no new players can join. Players already connected continue until they all disconnect; the room is then destroyed.
- A game script can show or hide named floor geometry objects for all players or a specified subset of players.
- A game script can query the current player→vote-region mapping for all tracked players.
- A `GameSpec` defines the world's instruction specs, vote region specs, floor geometry objects, their initial visibility states, and optional walkable area variants.
- Floor geometry objects default to visible; vote regions default to inactive. Both can be overridden per-id in the scenario's initial visibility map.
- A walkable area variant is a named walkable area paired with a set of trigger geometry ids; the room's walkable area switches to that variant as soon as every trigger geometry is simultaneously visible for all players.
- When a walkable area variant becomes active and a player's current position falls outside the new walkable area, the server immediately displaces that player to the nearest valid position within the new area.
