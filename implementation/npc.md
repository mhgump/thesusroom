# NPC Framework — Implementation

## Relevant Files

```
server/src/
  npc/
    NpcSpec.ts       — Type definitions: NpcSpec, NpcTrigger, NpcUxFlags
    NpcEntity.ts     — NpcEntity interface, NpcContext, type registry (registerNpcType)
    NpcAbilities.ts  — Ability function implementations (move, setPosition, dealDamage)
    NpcHelpers.ts    — Helper function implementations (getPosition, getPlayersInRange, etc.)
    NpcManager.ts    — Lifecycle: spawn, tick scheduling, event collection
    entities/
      StillDamager.ts — NPC that stands still and damages players on contact
  ScenarioRegistry.ts   — Creates room instances on demand; MapSpec contains NPC declarations
content/server/
  maps/demo.ts       — Demo map spec (side-effect import registers any NPC types it uses; the shipped demo has `npcs: []`)
```

## World Architecture

`ScenarioRegistry` creates room instances on demand (or at pre-warm time). Each room is backed by one `Room` instance and one WebSocket room. Map definitions (walkable area, NPC specs) live in `content/server/maps/` files; `MapSpec` carries the `npcs` array passed to `Room` at construction time.

## NPC Lifecycle

1. `Room` constructor calls `NpcManager.spawnAll(npcs)`.
2. `NpcManager.spawn` calls `world.addPlayer(npcId, spawnX, spawnZ)` and registers the entity.
3. For periodic triggers, `setInterval` is started immediately; first tick fires after one full period.
4. When a human player joins, `Room.addPlayer` sends a `player_joined` for each NPC.
5. On each `Room.runTick`, `NpcManager.onPlayerMove(moveEvents)` runs all `on-player-move` entities and returns their emitted events, which are appended to the triggering move's broadcast.

## Type Registry

`NpcEntity.ts` maintains a module-level `Map<string, NpcFactory>`. `registerNpcType(name, factory)` adds to it at module load time. To register a new type, add a side-effect import in the relevant `content/server/maps/*.ts` file.

## NpcContext Construction

`NpcManager` calls `buildNpcAbilities` (`NpcAbilities.ts`) and `buildNpcHelpers` (`NpcHelpers.ts`) at tick time, filtering by `allowedAbilities` / `allowedHelpers` so undeclared capabilities are absent rather than throwing.

## Event Routing

| Source | Delivery |
|---|---|
| `on-player-move` NPC events | Appended to the triggering player's `move_ack` + `player_update` |
| Periodic NPC events | Broadcast as a standalone `player_update` with the NPC's entity id |
