# NPC Framework — Spec

- NPCs are server-controlled entities that exist inside the same `World` simulation as players; they share the same physics (movement, collision, touch detection).
- Clients see NPCs as persistent remote entities and receive their state updates through the standard `player_update` message stream.
- Each NPC has a world-scoped string id of the form `npc:<spec.id>`; this prefix distinguishes NPCs from human players.
- An NPC entity is a stateful class registered under a type name; entity-owned state persists across tick calls.
- The `trigger` field controls when `tick` is called: `'on-player-move'` fires after every `processMove` for any human player; `{ period: number }` fires every `period` ms of server wall-clock time.
- For `on-player-move` triggers, `ctx.triggerEvents` contains the `WorldEvent[]` produced by the triggering player's move. For periodic triggers, `ctx.triggerEvents` is always empty.
- Events emitted via `ctx.emitEvents` are appended to the current tick's broadcast. For `on-player-move` triggers they ride the triggering player's `move_ack` and `player_update`; for periodic triggers they are broadcast as a standalone `player_update` from the NPC's entity id.
- NPC abilities are direct mutations of server world state; helpers are read-only queries. Each NPC declares the subset it may use via `allowedAbilities` / `allowedHelpers`; undeclared capabilities are absent from the context at runtime.
- An NPC's allowed-ability set is fixed at spec definition time and cannot change at runtime.
- `getPlayersInRange` returns only human player ids; NPCs are excluded.
- The `ux.has_health` flag: when `false`, no heart renders for this NPC on any client.
