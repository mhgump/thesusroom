# Demo World — Assumptions

## Scenario Routing

- The server pre-warms the `demo` scenario on startup; its room is always open for new connections.
- Connecting players are routed to the open room instance for the scenario name parsed from the WebSocket URL path (first path segment). An empty or missing segment defaults to `demo`.
- Five scenarios are registered at startup: `demo`, `scenario1`, `scenario2`, `scenario3`, `scenario4`. Connections to any other scenario name are rejected with close code 4004.
- The client derives the scenario name from `window.location.pathname` and appends it to the WebSocket URL as a path segment.

## Rooms

The demo world has two rooms connected by a single north-south doorway.

| Room | Role | Width | Depth | Centre |
|---|---|---|---|---|
| `room1` | Spawn room | 0.75 | 0.75 | `(0, 0)` (origin) |
| `room2` | North room (locked until door opens) | 0.75 | 0.75 | `(0, -0.75)` |

- Players spawn at the world origin (Room 1 centre) unless overridden.
- Room 1's `disabledWalls: ['north']` removes barrier segments along the shared wall so the doorway geometry is uninterrupted.
- Both rooms are viewport-sized with a `cameraRect` of `{ xMin: -0.375, xMax: 0.375, zMin: -0.375, zMax: 0.375 }`.

## Connection

- `room1.north ↔ room2.south`, centred on the shared wall (`positionA = positionB = 0.5`), doorway width `0.25`.
- `cameraTransition` is a triangle in room1-local coordinates with apex at the Room 1 centre `(0, 0)` and base at `(±0.05, -0.375)` — the doorway's width at the shared wall.

## Walkable Areas

Authored in `content/server/maps/demo.ts` and mirrored in `content/client/maps/demo.ts`:

- `DEFAULT_WALKABLE` — Room 1 only (`hw=0.3468, hd=0.3468` about origin). Room 2 is locked while the door is shut.
- `BOTH_ROOMS` — Room 1 + thin connector `(cz=-0.375, hw=0.0968, hd=0.0282)` + Room 2 (`cz=-0.75, hw=0.3468, hd=0.3468`).
- A `walkableVariant` with trigger id `['door_open']` swaps to `BOTH_ROOMS` once the script reveals the `door_open` geometry.

## Physics Geometry

The demo map uses Rapier physics. Six static walls enclose the two rooms with a 0.1-wide doorway gap at `z = -0.375`. The `north_door` is a toggleable 0.25 × 0.06 block that sits across the doorway — visible (and solid) when the door is closed, hidden (and passable) after the script opens it. A second invisible `door_open` marker is used by the `walkableVariants` trigger.

## Player Spawn

- All players (human and NPC) spawn at `(0, 0)` — Room 1's centre — unless overridden by an NPC spec's `spawnX` / `spawnZ`.

## Demo Game Script

The demo scenario (`content/server/scenarios/demo.ts`) runs a `DemoScript` with this flow:

- **Bot fill**: on the first human connection the script arms a one-shot `BOT_FILL_DELAY_MS = 2_000` timer. When it fires, if the door has not already been opened it spawns `max(0, 4 − currentPlayerCount)` `DEMO_BOT` instances to top the room up to four players.
- **Door opening**: as soon as the room reaches four players (humans + bots) the script calls `closeScenario`, hides the `north_door` block and shows the `door_open` trigger geometry (which triggers the `walkableVariant` swap on both server and client).
- **Room tracking**: every player's room transitions are watched; once a player enters `room2`, the script locks them to `room2`, waits `250 ms`, then restores the `north_door` only for that player (a visual-only door-close) and unlocks them.
- **Elimination timer**: `MOVE_WARN_DELAY_MS = 2_000` after the door opens, all still-in-room1 players receive the `rule_move` instruction. `ELIM_DELAY_MS = 6_000` after that warning, any players still in `room1` are eliminated.
- **Survivor fact**: once every living player has reached `room2`, the script waits `FACT_DELAY_MS = 1_000` and sends every survivor the `fact_{n}` instruction (where `n` is the survivor count, 1–4).

**Instruction specs** (authored in both `content/server/scenarios/demo.ts` and `content/client/maps/demo.ts`):

| id | label | text |
|---|---|---|
| `rule_move` | RULE | `"Players that do not continue will be eliminated"` |
| `fact_1` | FACT | `"1 player survived"` |
| `fact_2` | FACT | `"2 players survived"` |
| `fact_3` | FACT | `"3 players survived"` |
| `fact_4` | FACT | `"4 players survived"` |

The demo has **no vote regions and no NPCs** (`voteRegions: []`, `npcs: []` in the map spec). Door geometry is authored as `{ id: 'north_door', ... }` and `{ id: 'door_open', ... }` in `gameSpec.geometry`.
