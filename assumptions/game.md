# Game — Assumptions

- Player HP is initialised to 2 on spawn; the maximum HP value is 2. HP is a `0 | 1 | 2` integer (no negative or higher HP is representable). Initial value is included in the `welcome` message (local player) and `player_joined` messages (remote players and NPCs).
- `applyDamage` decrements HP by the supplied integer amount, floored at 0; no negative HP is possible.
- The maximum move speed is `0.645` world units / second.
- The per-move `dt` is clamped to 0.1 s inside `processMove`, so a long frame gap does not produce a large displacement step that would skip over collision geometry.
- `World` exposes per-player room tracking: `getPlayerRoom`, `setPlayerRoom`, `getAccessibleRooms`, and `setAccessibleRoomsOverride`. Only `getPlayerRoom` and `setPlayerRoom` have callers today — `setPlayerRoom` is driven from `GameScriptManager.onPlayerMoved`. `setAccessibleRoomsOverride` is reserved for future scenarios and has no caller; `getAccessibleRooms` is available but unused in shipped code.
- The accessible-rooms value is advisory only. Physical movement containment is still enforced exclusively by walkable geometry (AABB walkable rects, or Rapier walls/character controller when `PhysicsSpec` is present). Nothing rejects a move because the destination is outside `getAccessibleRooms`.
- With no override, `getAccessibleRooms(playerId)` returns `{currentRoom} ∪ defaultAdjacency(currentRoom)` scanned across registered map instances — the first map instance whose `defaultAdjacency` map contains `currentRoom` wins. When `currentRoom` is null the result is empty; when no registered instance lists the room in its adjacency map the result falls back to `{currentRoom}` alone.
- Room ids stored in and returned from these APIs are the scoped form `{mapInstanceId}_{localId}`.
