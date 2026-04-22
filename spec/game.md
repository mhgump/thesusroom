# Game — Spec

- A player move updates position at a maximum speed of 4 m/s; the delta time per move is capped at 100 ms.
- A `touched` event fires when two players' capsules first overlap during a move (leading edge only).
- Sustained capsule overlap does not re-fire `touched`; it fires again only after the players have separated and re-contacted.
- Touch pairs reset when a player's position is teleported.
- Player-player contact does not deal damage; only NPC actions can deal damage to a player.
- Players have a health value ranging from 0 to 2.
- At zero health a player is eliminated and immediately removed from the game world.
- Each player has an individual set of available actions that may change at any time based on game state.
- The server can grant or revoke any named action for a specific player at any time.
- Actions are discrete; one fires per button press.
