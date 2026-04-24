# NPC Framework — Assumptions

- NPC entity ids use the exact format `npc:<spec.id>` (literal colon separator, not a UUID).
- `getPlayersInRange` uses Euclidean distance and excludes NPCs from results.
- `dealDamage` is idempotent: when the target's HP is already 0, no event is returned and HP is unchanged.
- `setPosition` bypasses physics and clears all active touch pairs for the NPC; it is not suitable for continuous movement.
- The `move` action applies the same velocity clamping and dt cap (100 ms max) as a human player move.
- The `touched` world event fires only on first contact; an NPC that needs to re-detect contact after separation must track its own per-player contact state, since the framework clears touch pairs only via teleport.
- NPC entity objects are created once at `Room` construction and live for the server process lifetime; state is in-memory only and does not survive restarts.
- For periodic triggers, the first tick fires after one full period of simulated time has elapsed (not immediately at spawn). Periodic triggers are implemented as a self-rescheduling `Room.scheduleSimMs` chain rather than `setInterval`, so the period scales with the server's tick rate and the trigger stops cleanly when the NPC is despawned.
