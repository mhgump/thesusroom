# Scene — Assumptions

- Coordinate system: X = east (+right), Y = up, Z = south (+toward camera); floor at Y = 0.
- `CAPSULE_RADIUS = 0.35`; this value is embedded in the precomputed `WalkableArea` rects and must agree across all three locations where it appears in the codebase.
- Y-layer render order: −0.01 (background plane) < 0 (floor) < 0.005 (outside textures); collapsing these values causes z-fighting.
- The camera constraint polygon follows north-wall connections in a linear chain; rooms must form a linear north–south chain for the polygon to cover all rooms.
- `currentRoomId` in the Zustand store lags one frame behind `localPlayerPos.roomId`; use the store for JSX rendering and `localPlayerPos.roomId` for per-frame logic.
