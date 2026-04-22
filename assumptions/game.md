# Game — Assumptions

- Player HP is initialised to 2 on spawn; the value is included in the `welcome` message (local player) and `player_joined` messages (remote players and NPCs).
- `dealDamage` decrements HP by the supplied integer amount, floored at 0; no negative HP is possible.
