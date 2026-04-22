# NPC Framework

## Spec

### Overview

NPCs are **server-controlled entities** that live inside the same `World` simulation as players. They share the world's physics (movement, collision, touch detection) and interact with players through the same event pipeline. Clients see NPCs as persistent remote entities and receive their events through the standard `player_update` message stream.

### NPC Identity

Each NPC has a world-scoped string id of the form `npc:<spec.id>`. This prefix distinguishes NPCs from human players (UUID format) throughout the server.

### NPC Entity Definition

An NPC entity is a stateful TypeScript class registered under a type name:

```typescript
import { registerNpcType } from '../NpcEntity.js'
import type { NpcEntity, NpcContext } from '../NpcEntity.js'
import type { NpcSpec } from '../NpcSpec.js'

class MyNpc implements NpcEntity {
  readonly id: string
  readonly spec: NpcSpec
  // Entity-owned state — persists across tick calls
  private counter = 0

  constructor(id: string, spec: NpcSpec) {
    this.id = id
    this.spec = spec
  }

  tick(ctx: NpcContext): void {
    this.counter++
    // React to events, call actions, query world state
  }
}

registerNpcType('my-npc', (id, spec) => new MyNpc(id, spec))
```

### Tick Triggers

The `trigger` field in `NpcSpec` controls when `tick` is called:

| Trigger | When it fires |
|---|---|
| `'each-action'` | After every `processMove` call for any human player |
| `{ period: number }` | Every `period` ms of server wall-clock time (via `setInterval`) |

For `each-action` triggers, `ctx.triggerEvents` contains the `WorldEvent[]` produced by the player's move that triggered the tick. For periodic triggers, `ctx.triggerEvents` is always empty.

### NPC Context

Every tick call receives an `NpcContext`:

```typescript
interface NpcContext {
  npcId: string
  actions: Readonly<Partial<NpcActionFunctions>>   // restricted to allowedActions
  helpers: Readonly<Partial<NpcHelperFunctions>>   // restricted to allowedHelpers
  worldTime: number                                 // server wall-clock ms
  triggerEvents: readonly WorldEvent[]
  emitEvents: (events: WorldEvent[]) => void        // broadcast events to clients
}
```

Events passed to `emitEvents` are appended to the current tick's broadcast. For `each-action` triggers this means they ride the triggering player's `move_ack` and `player_update` messages. For periodic triggers they are broadcast as a standalone `player_update` from the NPC's entity id.

### Available Actions

Actions are direct mutations of server world state. Each NPC type declares which subset it may use via `allowedActions` — undeclared actions are not present in `ctx.actions` at runtime.

| Key | Signature | Description |
|---|---|---|
| `move` | `(jx, jz, dt) => WorldEvent[]` | Apply a movement step — identical physics to a human player move |
| `setPosition` | `(x, z) => void` | Teleport the NPC (clears touch pairs) |
| `dealDamage` | `(targetId, amount) => WorldEvent[]` | Decrement HP of a player; returns a `DamageEvent` if HP changed |

### Available Helpers

Helpers are read-only queries against server world state. Each NPC type declares which subset it may use via `allowedHelpers`.

| Key | Signature | Description |
|---|---|---|
| `getPosition` | `(entityId) => {x,z} \| null` | Position of any world entity by id |
| `getPlayersInRange` | `(x, z, range) => string[]` | Human player ids within Euclidean range (NPCs excluded) |
| `getDistanceTo` | `(fromId, toId) => number \| null` | Distance between two entities |
| `getAllPlayerIds` | `() => string[]` | All human player ids in the world |

### NPC Spec

```typescript
interface NpcSpec {
  id: string                       // Unique within the world
  type: string                     // Registered NPC type name
  spawnX: number
  spawnZ: number
  trigger: NpcTrigger
  allowedActions: readonly string[]
  allowedHelpers: readonly string[]
  ux: NpcUxFlags
  config?: unknown                  // Passed to constructor for type-specific config
}
```

### UX Flags

The `ux` object controls which client-side UI elements render for this NPC.

| Flag | Type | Default | Description |
|---|---|---|---|
| `has_health` | `boolean` | — | If `false`, no HP bar or heart icon renders for this NPC on any client |

### Action Restrictions

NPC enemies have a **static, fixed capability set** — they do not interact with any player-facing ability or active-ability logic. The actions available to an NPC are defined entirely by `allowedActions` and `allowedHelpers` in its spec. Unlike players, these sets cannot change at runtime.

---

## Implementation

### File Layout

```
server/src/
  npc/
    NpcSpec.ts          — Type definitions (NpcSpec, NpcTrigger, NpcUxFlags)
    NpcEntity.ts        — NpcEntity interface, NpcContext, type registry
    NpcActions.ts       — Action function implementations
    NpcHelpers.ts       — Helper function implementations
    NpcManager.ts       — Lifecycle: spawn, tick scheduling, event collection
    entities/
      StillDamager.ts   — Example NPC: stands still, damages on touch
  WorldManager.ts       — Manages multiple independent worlds
  DefaultServerWorld.ts — Default 3-room world config with NPCs
```

### World Architecture

The server maintains any number of independent **worlds**. Each world corresponds to one `Room` instance and one WebSocket room. Worlds are defined by a `ServerWorldSpec`:

```typescript
interface ServerWorldSpec {
  worldId: string
  walkable: WalkableArea      // Pre-computed walkable rectangles for physics
  npcs: NpcSpec[]             // NPCs to spawn at room creation
}
```

`WorldManager` creates all worlds at startup and routes connecting clients to a world via `assignPlayer`. Current routing policy: all clients go to the first/default world. Routing logic lives entirely in `WorldManager.assignPlayer` and can be replaced without touching Room or NPC code.

### NPC Lifecycle

1. `Room` constructor calls `NpcManager.spawnAll(npcs)`.
2. `NpcManager.spawn` calls `world.addPlayer(npcId, spawnX, spawnZ)` and registers the entity.
3. For periodic triggers, `setInterval` is started immediately.
4. When a human player joins, `Room.addPlayer` sends a `player_joined` message for each NPC.
5. On each `Room.processMove`, `NpcManager.onActionCompleted(moveEvents)` runs all `each-action` entities and returns their emitted events.
6. NPC-emitted events are appended to the triggering move's `move_ack` and `player_update` broadcasts.

### Event Routing

| Source | Delivery mechanism |
|---|---|
| `each-action` NPC events | Appended to the triggering player's `move_ack` + `player_update` |
| Periodic NPC events | Broadcast as `player_update` with the NPC's entity id |

### Client-Side Rendering

NPCs appear to clients as remote entities via `player_joined` with `isNpc: true`. Clients treat them identically to human remote players for position interpolation and event processing. The `hasHealth` flag suppresses the HP bar overlay when `false`.

To add a new NPC entity type:
1. Create `server/src/npc/entities/MyNpc.ts`
2. Call `registerNpcType('my-npc', factory)` at module level
3. Import the file in `DefaultServerWorld.ts` (side-effect import registers the type)
4. Add an `NpcSpec` entry to the world spec

---

## Expectations for Developers

### Adding a new NPC type

1. **Create the entity file** under `server/src/npc/entities/`.
2. **Implement `NpcEntity`** — a class with `id`, `spec`, and `tick(ctx)`. Own state goes in class fields; `tick` may mutate it freely.
3. **Call `registerNpcType`** at module level so the registry knows the type before the world spec is processed.
4. **Import the file** in `DefaultServerWorld.ts` (or whichever file builds your world spec) as a side-effect import: `import './npc/entities/MyNpc.js'`.
5. **Declare the spec** — set `allowedActions` and `allowedHelpers` to the minimum necessary; do not request helpers you don't use.

### Action safety rules

- `dealDamage` is idempotent if HP is already 0 — no event is returned.
- `move` applies the same velocity clamping (`dt` capped at 100 ms) and walkable-area physics as a human player move. Do not pass large `dt` values.
- `setPosition` bypasses physics and clears all active touch pairs for the NPC. Use only for spawning or scripted teleports, not continuous movement.

### Each-action tick performance

Each-action ticks fire on every human player move — potentially 60 Hz per player. Keep `tick` implementations O(n) or faster in number of players. Avoid allocating large structures inside `tick`.

### Periodic tick timing

Period values are server wall-clock milliseconds, not game ticks. The first firing happens after one full period elapses. Periods below ~16 ms are not recommended and may coalesce with frame timing.

### Statefulness and restarts

NPC entity objects are created once at `Room` construction and live for the lifetime of the server process. State is in-memory only — there is no persistence across server restarts. Design state accordingly: use it for ephemeral per-contact tracking, cooldowns, or internal counters, not for anything that must survive a restart.

### UX flags

- Always set `has_health` explicitly in the spec. The current flag set is intentionally minimal.
- If `has_health: false`, the client never renders an HP bar for the NPC. The NPC still has an internal `hp` field in `WorldPlayerState` and can still receive damage; it just doesn't display.

### NPC touch events

`touched` events in `ctx.triggerEvents` fire on **first contact** only (the World tracks active touch pairs). The NPC must clear its own per-contact state when it detects a player has moved out of range, as shown in `StillDamager.ts`. Do not assume `touched` fires repeatedly while overlapping.

### Adding world helpers or actions

To expose new helpers or actions to NPCs:
1. Add the function to `NpcHelperFunctions` / `NpcActionFunctions` interfaces in the respective file.
2. Implement it in `buildNpcHelpers` / `buildNpcActions`.
3. Add the key to `NpcHelperName` / `NpcActionName` union types.
4. Add the new key to the relevant NPC specs' `allowedHelpers` / `allowedActions`.

Any action that mutates world state should return any resulting `WorldEvent[]` so callers can pass them to `ctx.emitEvents` and have them reach clients.
