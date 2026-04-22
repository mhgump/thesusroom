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
| Room 2 | North corridor | `VIEWPORT_W × 0.25` (5) | `VIEWPORT_DEPTH × 1.0` (≈ 12.41) | `(0, −(R1D/2 + R2D/2))` |
| Room 3 | Arena | `VIEWPORT_W × 2.0` (40) | `VIEWPORT_DEPTH × 2.0` (≈ 24.82) | `(0, R2_centre − (R2D/2 + R3D/2))` |
| South Hall | South corridor | `VIEWPORT_W × 0.25` (5) | `VIEWPORT_DEPTH × 1.0` (≈ 12.41) | `(0, +(R1D/2 + SHD/2))` — mirror of Room 2 |
| South Room | Voting room | `VIEWPORT_W × 1.0` (20) | `VIEWPORT_DEPTH × 1.0` (≈ 12.41) | `(0, SH_centre + (SHD/2 + SRD/2))` |

## Connections

- Room 1 ↔ Room 2: centred on the north wall of Room 1 / south wall of Room 2; doorway width = `VIEWPORT_W × 0.25` (= full Room 2 width).
- Room 2 ↔ Room 3: centred on the north wall of Room 2 / south wall of Room 3; same doorway width.
- Room 1 ↔ South Hall: centred on the south wall of Room 1 / north wall of South Hall; doorway width = `VIEWPORT_W × 0.25` (= full South Hall width).
- South Hall ↔ South Room: centred on the south wall of South Hall / north wall of South Room; same doorway width.
- No other connections exist.

## Camera Rects (room-local)

Each room's `cameraRect` is authored in room-local coordinates (origin at room centre):

| Room | xMin | xMax | zMin | zMax | Rationale |
|---|---|---|---|---|---|
| Room 1 | 0 | 0 | 0 | 0 | Smaller than viewport — camera fixed at centre |
| Room 2 | `−VIEWPORT_W × 0.125` | `+VIEWPORT_W × 0.125` | `−VIEWPORT_DEPTH / 2` | `+VIEWPORT_DEPTH / 2` | Corridor narrower than viewport — track full floor |
| Room 3 | `−VIEWPORT_W / 2` | `+VIEWPORT_W / 2` | `−VIEWPORT_DEPTH / 2` | `+VIEWPORT_DEPTH / 2` | Large room — keep viewport edge inside floor |
| South Hall | `−VIEWPORT_W × 0.125` | `+VIEWPORT_W × 0.125` | `−VIEWPORT_DEPTH / 2` | `+VIEWPORT_DEPTH / 2` | Identical to Room 2 |
| South Room | 0 | 0 | 0 | 0 | Exactly viewport-sized — camera fixed at centre |

## Camera Transition Zones

Each connection has an authored `cameraTransition` with corners in room-A-local coordinates:

- **Room 1 → Room 2** (`roomIdA = 'room1'`): triangle — apex at room1 camera rect point `(0, 0)`, base at room2's south camera rect edge `(±VIEWPORT_W × 0.125, −ROOM_DEPTH / 2)`.

- **Room 2 → Room 3** (`roomIdA = 'room2'`): trapezoid — room2's north camera rect edge `(±VIEWPORT_W × 0.125, −VIEWPORT_DEPTH / 2)` widening to room3's south camera rect edge `(±VIEWPORT_W / 2, −VIEWPORT_DEPTH)` (room2-local).

- **Room 1 → South Hall** (`roomIdA = 'room1'`): triangle — apex at room1 camera rect point `(0, 0)`, base at south_hall's north camera rect edge `(±VIEWPORT_W × 0.125, +ROOM_DEPTH / 2)`. Z values are positive (south direction).

- **South Hall → South Room** (`roomIdA = 'south_hall'`): triangle — base at south_hall's south camera rect edge `(±VIEWPORT_W × 0.125, +VIEWPORT_DEPTH / 2)`, apex at south_room's camera rect point `(0, +VIEWPORT_DEPTH)` (south_hall-local).

## Player Spawn

- All players (human and NPC) spawn at `(0, 0)` — Room 1's centre — unless overridden by an NPC spec's `spawnX`/`spawnZ`.

## NPC: `room3-sentinel`

- Type: `still-damager`; id: `room3-sentinel`; spawned at Room 3's centre.
- Trigger: `each-action` (ticks after every human player move).
- Allowed actions: `dealDamage`. Allowed helpers: `getPosition`, `getPlayersInRange`.
- `ux.has_health: false` — no heart renders for this NPC.
- Behaviour: stands still; deals 1 damage to any player on first capsule contact; re-arms per-player once the player exits touch radius (`CAPSULE_RADIUS × 2 + 0.1 = 0.80` world units).

## Game Script: Demo Voting

The demo world runs a `DemoGameScript` with the following `GameSpec`:

**Instruction specs:**
- `vote_instruction`: text = `"Vote Yes or No"`

**Vote regions:**

| id | label | color | position | radius |
|---|---|---|---|---|
| `vote_yes` | Yes | `#2ecc71` | `(SOUTH_ROOM_CENTER_X − 5, SOUTH_ROOM_CENTER_Z)` | 3 |
| `vote_no` | No | `#e74c3c` | `(SOUTH_ROOM_CENTER_X + 5, SOUTH_ROOM_CENTER_Z)` | 3 |

Both vote regions are enabled by `DemoGameScript.onPlayerConnect` (idempotent; activated on first player connect and stay enabled).

The client-side `DEFAULT_GAME_SPEC` in `src/game/DefaultGame.ts` mirrors the server's vote region definitions. `VoteRegions.tsx` renders both circles unconditionally — client rendering is always-on and not gated on server enable/disable state.

**Demo script rules:**
- On player connect: enable both vote regions, send `vote_instruction` to the connecting player, start a 30-second elimination timer.
- A player's vote is counted the moment they step inside a vote region circle (`hypot(dx, dz) ≤ 3`).
- Entering `vote_yes`: vote recorded, timer cancelled — player survives.
- Entering `vote_no`: vote recorded, timer cancelled — player eliminated immediately.
- 30 seconds elapse without entering any region: player eliminated.
- The vote timeout constant is exactly `30 000 ms`.
