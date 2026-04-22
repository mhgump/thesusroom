# Game — Spec

- A player move updates position at a maximum speed of 4 m/s; the delta time per move is capped at 100 ms.
- A `touched` event fires when two players' capsules first overlap during a move (leading edge only).
- Sustained capsule overlap does not re-fire `touched`; it fires again only after the players have separated and re-contacted.
- Touch pairs reset when a player's position is teleported.
- Players have a health value ranging from 0 to 2.
- At zero health a player is eliminated.
- Game is organised into rounds; each round defines the set of available actions.
- `SKIP` is always available and is the default action in every round.
- At most 3 actions are available in any round.
- Actions are discrete; one fires per button press.
- A `round_config` message communicates the current round and its available actions, used both at initial connection and for mid-game round changes.
