# Scene — Implementation

## Relevant Files

```
src/scene/
  GameScene.tsx      — Root scene component; room rendering, camera, lighting
  Player.tsx         — Local player: world simulation, move dispatch, room tracking
  localPlayerPos.ts  — Mutable shared object { x, z, roomId } written each frame
  VoteRegions.tsx    — Renders vote region discs, border rings, and text labels from DEMO_GAME_SPEC
src/content/
  maps/demo.ts       — Demo map spec: DEMO_WORLD_SPEC, DEMO_WALKABLE, DEMO_CAMERA_SHAPES, DEMO_GAME_SPEC
src/game/
  WorldSpec.ts       — Room position BFS, walkable area computation, world types
  RoomSpec.ts        — RoomSpec and RoomConnection type definitions
  CameraConstraint.ts — buildCameraConstraintShapes, clampToShapes
  World.ts           — Shared physics simulation (identical to server copy)
src/scene/
  Ground.tsx         — Floor mesh with texture tiling
  Walls.tsx          — Barrier wall segmentation (segmentWall)
  Boundary.tsx       — BgPlane, RoomOutsideTextures
```

## Room Positioning

`WorldSpec.computeRoomPositions` runs BFS from `rooms[0]` at the origin. For each connection from a known room to an unknown one, the door centre is computed in world space from the known room's wall edge, then the unknown room's centre is back-solved from that point. All room centres are in world space for all downstream logic.

## Walkable Area Physics

`WalkableArea` is a precomputed list of axis-aligned rects, each inset by `CAPSULE_RADIUS`:
- One rect per room floor.
- One thin corridor rect per connection at the shared floor edge: half-width = `doorWidth/2 − r`, half-depth = `r`.

`World.processMove` runs a three-pass collision check (full move → X-only → Z-only) against `inWalkable`, enabling wall-sliding. The client computes `WalkableArea` in `src/content/maps/demo.ts` via `computeWalkableArea`; the server inlines it in `server/src/content/maps/demo.ts`. The two must use identical constants.

## Room Rendering

`GameScene.tsx` reads `currentRoomId` from the Zustand store to determine which rooms to render: the active room plus its `visibility` list. Each room renders in a `<group>` at its world-space centre so `Ground`, `Barrier`, and `RoomOutsideTextures` use room-local coordinates.

## Camera Constraint Shapes

`CameraConstraint.ts` exports `buildCameraConstraintShapes` and `clampToShapes`.

`buildCameraConstraintShapes(world, roomPositions)` converts authored specs to world-space shapes:
- **Rects**: each room's `cameraRect` (room-local `{ xMin, xMax, zMin, zMax }`) is offset by the room's world-space centre to produce a world-space `CameraRect`. Rooms without an authored `cameraRect` default to a point at the room centre.
- **Zones**: each connection's `cameraTransition.corners` (in room-A-local coordinates) are offset by room A's world position to produce world-space `CameraZone` polygons.

`DEMO_CAMERA_SHAPES` is computed once at module load in `src/content/maps/demo.ts` and reused every frame.

`clampToShapes(shapes, x, z)` projects the player position to the nearest point in the union of all rects and zones each frame:
1. **Inside test**: check all rects with an axis-aligned test; check all zones with ray casting (ray from point in +X direction; odd crossing count = inside). Polygon winding order does not matter.
2. **If inside any shape**: return the point unchanged.
3. **If outside all shapes**: find the nearest boundary point across all rects (`clamp(x, xMin, xMax)`) and zones (nearest on each edge via `nearestOnSeg`), return the globally closest.

## Camera Damping

`GameScene.tsx` maintains a `camTargetRef` (the smoothed camera ground-plane position). Each frame in the `useFrame` callback (priority −2):

1. Compute the constrained target via `clampToShapes`.
2. Apply independent exponential smoothing per axis: `alpha = 1 − exp(−delta / T)` where `T` is `DAMPING_X` or `DAMPING_Z` (both 0.1 s).
3. Set the camera's world position from the smoothed target: `(cx, CAMERA_DIST·cos θ, cz + CAMERA_DIST·sin θ)`.

The smoothed target is initialised to the first-frame clamped position to prevent a jump from the origin.

## Barrier Wall Segmentation

`segmentWall(from, to, openings[])` in `Walls.tsx` returns solid intervals after cutting doorway openings. Each interval renders as a separate `BoxGeometry` mesh. E/W walls extend by `barrierThickness` past each floor end to cover corners, except when the corresponding N/S wall has openings — in that case the E/W wall is trimmed to the floor edge to prevent overlap into the adjacent room.

## localPlayerPos

`localPlayerPos.ts` exports a mutable `{ x, z, roomId }` object. `Player.tsx` writes to it every frame. `GameScene.tsx` reads it in `useFrame` for camera follow. When `getDefaultRoomAtPosition` returns a different `roomId`, `store.setCurrentRoomId` is also called to trigger JSX room-set updates.

## Vote Regions

`VoteRegions.tsx` reads `DEMO_GAME_SPEC.voteRegions` from `src/content/maps/demo.ts` and renders each as a `<group>` at its world-space `(x, 0, z)` position. Each group contains three meshes flat on the XZ plane (all rotated `[-π/2, 0, 0]`):

1. **Fill disc** (`CircleGeometry`, 64 segments) at Y = 0.002; `meshBasicMaterial` with the region colour, `transparent`, `opacity: 0.35`.
2. **Border ring** (`RingGeometry`, inner radius = `r − 0.12`, outer = `r`, 64 segments) at Y = 0.003; opaque region colour.
3. **Label** (`Text` from `@react-three/drei`) at Y = 0.004; `fontSize: 1.5`, region colour, centred on both axes.

Vote regions are always rendered regardless of which regions are currently enabled on the server; visibility is decorative, not coupled to server game state.

## Ground Texture

`Ground.tsx`: with a `FloorTextureSpec`, repeat = `fill_x ? fw/tile_width : tile_x_count` (same for Y). Without one: `Textures.fallbackGround()` with `repeat = (fw/4, fd/4)`.
