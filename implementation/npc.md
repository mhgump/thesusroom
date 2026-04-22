# NPC Framework — Implementation

## Relevant Files

```
server/src/
  npc/
    NpcSpec.ts       — Type definitions: NpcSpec, NpcTrigger, NpcUxFlags
    NpcEntity.ts     — NpcEntity interface, NpcContext, type registry (registerNpcType)
    NpcActions.ts    — Action function implementations (move, setPosition, dealDamage)
    NpcHelpers.ts    — Helper function implementations (getPosition, getPlayersInRange, etc.)
    NpcManager.ts    — Lifecycle: spawn, tick scheduling, event collection
    entities/
      StillDamager.ts — NPC that stands still and damages players on contact
  WorldManager.ts       — Creates worlds at startup; routes connecting clients
  DefaultServerWorld.ts — Default world spec with NPC declarations
```

## World Architecture

`WorldManager` creates all worlds at server startup, each backed by one `Room` instance and one WebSocket room. Worlds are defined by `ServerWorldSpec` (worldId, walkable area, npc specs). Routing logic lives entirely in `WorldManager.assignPlayer`; the current policy sends all clients to the first world.

## NPC Lifecycle

1. `Room` constructor calls `NpcManager.spawnAll(npcs)`.
2. `NpcManager.spawn` calls `world.addPlayer(npcId, spawnX, spawnZ)` and registers the entity.
3. For periodic triggers, `setInterval` is started immediately; first tick fires after one full period.
4. When a human player joins, `Room.addPlayer` sends a `player_joined` for each NPC.
5. On each `Room.processMove`, `NpcManager.onActionCompleted(moveEvents)` runs all `each-action` entities and returns their emitted events, which are appended to the triggering move's broadcast.

## Type Registry

`NpcEntity.ts` maintains a module-level `Map<string, NpcFactory>`. `registerNpcType(name, factory)` adds to it at module load time. To register a new type, import its file as a side-effect import in `DefaultServerWorld.ts`.

## NpcContext Construction

`NpcManager` calls `buildNpcActions` (`NpcActions.ts`) and `buildNpcHelpers` (`NpcHelpers.ts`) at tick time, filtering by `allowedActions` / `allowedHelpers` so undeclared capabilities are absent rather than throwing.

## Event Routing

| Source | Delivery |
|---|---|
| `each-action` NPC events | Appended to the triggering player's `move_ack` + `player_update` |
| Periodic NPC events | Broadcast as a standalone `player_update` with the NPC's entity id |
