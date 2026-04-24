# Game — Spec

- A player move updates position at a bounded maximum speed.
- A `touched` event fires when two players' capsules first overlap during a move (leading edge only).
- Sustained capsule overlap does not re-fire `touched`; it fires again only after the players have separated and re-contacted.
- Touch pairs reset when a player's position is teleported.
- Player-player contact does not deal damage; only NPCs can deal damage to a player.
- Players have an integer health value.
- At zero health a player is eliminated and immediately removed from the game world.
