# Game Script — Assumptions

- `GameSpec` and `GameScript` types are defined in `src/game/GameSpec.ts` (client) and `server/src/GameSpec.ts` + `server/src/GameScript.ts` (server). The GameSpec definition is kept identical between both copies; a diff is a bug.
- Vote region assignment is computed by Euclidean distance: a player is inside region `r` when `hypot(px − r.x, pz − r.z) ≤ r.radius`.
- Only one region is assigned per player at a time; if a player is simultaneously within multiple active regions, the first one found in iteration order wins.
- The `onVoteChanged` callback fires only when a player's region assignment changes, not on every move. Callbacks are per-listener, not per-region: one `onVoteChanged` call registers one listener covering all supplied region ids.
- The assignments map passed to `onVoteChanged` callbacks contains every currently tracked player (all connected human players), not just those in the specified regions.
- `after` uses `setTimeout`; the callback is dropped if `clearTimeout` is called with the returned handle before it fires.
- An `instruction` message received by the client is converted into a `ShowRuleEvent` with a single rule entry whose `label` is `'COMMAND'` and whose `text` is the instruction text. The rule popup is shown immediately (no 250 ms buffer delay) because the `instruction` message is sent directly to the target player and not through the broadcast path.
- Calling `eliminatePlayer` from within an `onVoteChanged` or `after` callback is safe: `Room.removePlayer` is re-entrant (map deletions on already-absent keys are no-ops).
- Game script objects are created once at `Room` construction time and live for the server process lifetime; state is in-memory only and does not survive restarts.
- `onPlayerConnect` callbacks are registered inside the `GameScriptManager` and forwarded to the active script; `onPlayerDisconnect` is not exposed to the script, but the player is removed from the tracked set and future `getPlayerIds()` calls will not include them.
