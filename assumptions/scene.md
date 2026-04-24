# Scene — Assumptions

- Coordinate system: X = east (+right), Y = up, Z = south (+toward camera); floor at Y = 0.
- `CAPSULE_RADIUS = 0.0282`; this value is embedded in the precomputed `WalkableArea` rects and must agree across every location where it appears in the codebase (shared `World.ts`, `HeartSprite.tsx`, `CapsuleFallback.tsx`, and the map specs).
- Y-layer render order: −0.01 (background plane) < 0 (floor) < 0.002 (vote circle fill) < 0.003 (vote circle border ring) < 0.004 (vote circle label) < 0.005 (outside textures); collapsing these values causes z-fighting.
- Camera rects are authored in room-local coordinates (origin at room centre, same axes as world space) inside each `RoomSpec`. Transition zone corners are authored in room-A-local coordinates inside each `RoomConnection`. Both are converted to world space once at startup by `buildCameraConstraintShapes`.
- Camera damping uses independent exponential time constants for X and Z axes (`DAMPING_X = DAMPING_Z = 0.1` s). At 60 fps this yields ≈ 15 % movement per frame toward the constrained target.
- The camera constraint works for any rectangular grid graph of room connections; rooms must not overlap (enforced by `validateWorldSpec`), but no linear chain structure is assumed.
- `currentRoomId` in the Zustand store lags one frame behind `localPlayerPos.roomId`; use the store for JSX rendering and `localPlayerPos.roomId` for per-frame logic.
