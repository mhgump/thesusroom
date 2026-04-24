# Game — Assumptions

- Player HP is initialised to 2 on spawn; the maximum HP value is 2. HP is a `0 | 1 | 2` integer (no negative or higher HP is representable). Initial value is included in the `welcome` message (local player) and `player_joined` messages (remote players and NPCs).
- `applyDamage` decrements HP by the supplied integer amount, floored at 0; no negative HP is possible.
- The maximum move speed is `0.645` world units / second.
- The per-move `dt` is clamped to 0.1 s inside `processMove`, so a long frame gap does not produce a large displacement step that would skip over collision geometry.
