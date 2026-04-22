# Demo World — Assumptions

## World Routing

- All connecting players are assigned to the single default world (`worldId: 'default'`); there is no per-player routing logic in the demo.

## Room Dimensions

Dimensions are expressed in terms of two derived viewport constants:

```
VIEWPORT_W = 20 world units
CAMERA_ANGLE = 25°
VIEWPORT_DEPTH = VIEWPORT_W / (16/9) / cos(25°)   ≈ 12.41 world units
```

| Room | Role | Width | Depth | Centre |
|---|---|---|---|---|
| Room 1 | Lobby / start | `VIEWPORT_W × 0.75` (15) | `VIEWPORT_DEPTH × 0.75` (≈ 9.31) | `(0, 0)` (origin) |
| Room 2 | Corridor | `VIEWPORT_W × 0.25` (5) | `VIEWPORT_DEPTH × 1.0` (≈ 12.41) | `(0, −(R1D/2 + R2D/2))` |
| Room 3 | Arena | `VIEWPORT_W × 2.0` (40) | `VIEWPORT_DEPTH × 2.0` (≈ 24.82) | `(0, R2_centre − (R2D/2 + R3D/2))` |

## Connections

- Room 1 ↔ Room 2: centred on the north wall of Room 1 / south wall of Room 2; doorway width = `VIEWPORT_W × 0.25` (= full Room 2 width).
- Room 2 ↔ Room 3: centred on the north wall of Room 2 / south wall of Room 3; same doorway width.
- No other connections exist.

## Camera Rects (room-local)

Each room's `cameraRect` is authored in room-local coordinates (origin at room centre):

| Room | xMin | xMax | zMin | zMax | Rationale |
|---|---|---|---|---|---|
| Room 1 | 0 | 0 | 0 | 0 | Smaller than viewport — camera fixed at centre |
| Room 2 | `−VIEWPORT_W × 0.125` | `+VIEWPORT_W × 0.125` | `−VIEWPORT_DEPTH / 2` | `+VIEWPORT_DEPTH / 2` | Corridor narrower than viewport — track full floor |
| Room 3 | `−VIEWPORT_W / 2` | `+VIEWPORT_W / 2` | `−VIEWPORT_DEPTH / 2` | `+VIEWPORT_DEPTH / 2` | Large room — keep viewport edge inside floor |

## Camera Transition Zones

Each connection has an authored `cameraTransition` with corners in room-A-local coordinates:

- **Room 1 → Room 2** (`roomIdA = 'room1'`): three corners forming a triangle — the apex at the room1 camera rect point `(0, 0)`, base at room2's south camera rect edge `(±VIEWPORT_W × 0.125, −ROOM_DEPTH / 2)`. Room1 is at the world origin so these are also world-space coordinates.

- **Room 2 → Room 3** (`roomIdA = 'room2'`): four corners forming a trapezoid — room2's north camera rect edge `(±VIEWPORT_W × 0.125, −VIEWPORT_DEPTH / 2)` widening to room3's south camera rect edge `(±VIEWPORT_W / 2, −VIEWPORT_DEPTH)`. All Z values are in room2-local coordinates.

## Player Spawn

- All players (human and NPC) spawn at `(0, 0)` — Room 1's centre — unless overridden by an NPC spec's `spawnX`/`spawnZ`.

## NPC: `room3-sentinel`

- Type: `still-damager`; id: `room3-sentinel`; spawned at Room 3's centre.
- Trigger: `each-action` (ticks after every human player move).
- Allowed actions: `dealDamage`. Allowed helpers: `getPosition`, `getPlayersInRange`.
- `ux.has_health: false` — no heart renders for this NPC.
- Behaviour: stands still; deals 1 damage to any player on first capsule contact; re-arms per-player once the player exits touch radius (`CAPSULE_RADIUS × 2 + 0.1 = 0.80` world units).
