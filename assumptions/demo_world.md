# Demo World — Assumptions

## World Routing

- All connecting players are assigned to the single default world (`worldId: 'default'`); there is no per-player routing logic in the demo.

## Room Dimensions

Dimensions are expressed in terms of two derived viewport constants:

```
VIEWPORT_W = 20 world units
CAMERA_ANGLE = 25°
VIEWPORT_H = VIEWPORT_W / (16/9) / cos(25°)   ≈ 12.26 world units
```

| Room | Role | Width | Height | Centre |
|---|---|---|---|---|
| Room 1 | Lobby / start | `VIEWPORT_W × 0.75` | `VIEWPORT_H × 0.75` | `(0, 0)` (origin) |
| Room 2 | Corridor | `VIEWPORT_W × 0.25` | `VIEWPORT_H × 1.0` | `(0, −(R1H/2 + R2H/2))` |
| Room 3 | Arena | `VIEWPORT_W × 2.0` | `VIEWPORT_H × 2.0` | `(0, R2_centre − (R2H/2 + R3H/2))` |

- Room 2 is narrower than the viewport and uses `cameraRect: 'full'` so the camera tracks the full room floor width.

## Connections

- Room 1 ↔ Room 2: centred on the north wall of Room 1 / south wall of Room 2; doorway width = `VIEWPORT_W × 0.25` (= full Room 2 width).
- Room 2 ↔ Room 3: centred on the north wall of Room 2 / south wall of Room 3; same doorway width.
- No other connections exist.

## Player Spawn

- All players (human and NPC) spawn at `(0, 0)` — Room 1's centre — unless overridden by an NPC spec's `spawnX`/`spawnZ`.

## NPC: `room3-sentinel`

- Type: `still-damager`; id: `room3-sentinel`; spawned at Room 3's centre.
- Trigger: `each-action` (ticks after every human player move).
- Allowed actions: `dealDamage`. Allowed helpers: `getPosition`, `getPlayersInRange`.
- `ux.has_health: false` — no heart renders for this NPC.
- Behaviour: stands still; deals 1 damage to any player on first capsule contact; re-arms per-player once the player exits touch radius (`CAPSULE_RADIUS × 2 + 0.1 = 0.80` world units).
