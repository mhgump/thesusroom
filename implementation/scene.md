# Scene — Implementation

## Relevant Files

```
react-three-capacitor/src/scene/
  GameScene.tsx      — Root scene component; room rendering, camera, lighting
  Player.tsx         — Local player: world simulation, move dispatch, room tracking
  Ground.tsx         — Floor mesh with texture tiling
  Walls.tsx          — Barrier mesh built from per-room pre-authored barrier segments
  Boundary.tsx       — BgPlane, RoomOutsideTextures
  VoteRegions.tsx    — Renders vote region discs, border rings, and text labels
  GeometryLayer.tsx  — Renders toggleable floor-geometry objects
  ButtonLayer.tsx    — Renders map buttons
react-three-capacitor/src/game/
  WorldSpec.ts       — Room position BFS, walkable area computation, world types
  RoomSpec.ts        — RoomSpec and RoomConnection type definitions (including barrierSegments)
  CameraConstraint.ts — buildCameraConstraintShapes, clampToShapes
  World.ts           — Shared physics simulation
  localPlayerPos.ts  — Mutable shared object { x, z, roomId } written each frame
content/client/maps/
  demo.ts            — Demo map spec: DEMO_WORLD_SPEC, walkable rects, camera shapes, DEMO_GAME_SPEC
  scenario{1..4}.ts  — Per-scenario client map specs
  index.ts           — Exports CURRENT_MAP resolved from CURRENT_SCENARIO_ID
content/server/maps/
  demo.ts            — Server-side demo map spec (walkable rects, physics geometry)
  scenario{1..4}.ts  — Per-scenario server map specs
```

## Room Positioning

`WorldSpec.computeRoomPositions` runs BFS from `rooms[0]` at the origin. For each connection from a known room to an unknown one, the door centre is computed in world space from the known room's wall edge, then the unknown room's centre is back-solved from that point. All room centres are in world space for all downstream logic.

## Walkable Area Physics

`WalkableArea` is a list of axis-aligned rects authored per map. In AABB mode, `World.processMove` runs a three-pass collision check (full move → X-only → Z-only) against `inWalkable`, enabling wall-sliding. In Rapier mode (maps that provide a `PhysicsSpec`), walls and toggleable geometry are registered as colliders and the Rapier `KinematicCharacterController` enforces collision continuously; `WalkableArea` is still retained as a fallback snap target when variants switch.

Walkable rects are authored in `content/client/maps/*.ts` (client) and `content/server/maps/*.ts` (server); the two copies must use identical constants.

## Room Rendering

`GameScene.tsx` reads `currentRoomId` from the Zustand store to determine which rooms to render: the active room plus its `visibility` list (filtered by per-player visibility overrides). Each room renders in a `<group>` at its world-space centre so `Ground`, `Barrier`, and `RoomOutsideTextures` use room-local coordinates.

## Camera Constraint Shapes

`CameraConstraint.ts` exports `buildCameraConstraintShapes` and `clampToShapes`.

`buildCameraConstraintShapes(world, roomPositions)` converts authored specs to world-space shapes:
- **Rects**: each room's `cameraRect` (room-local `{ xMin, xMax, zMin, zMax }`) is offset by the room's world-space centre to produce a world-space `CameraRect`. Rooms without an authored `cameraRect` default to a point at the room centre.
- **Zones**: each connection's `cameraTransition.corners` (in room-A-local coordinates) are offset by room A's world position to produce world-space `CameraZone` polygons.

The camera shapes are computed once at map module load time (e.g. `DEMO_CAMERA_SHAPES` in `content/client/maps/demo.ts`) and reused every frame.

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

## Barriers

Barrier geometry is not computed at runtime. Each `RoomSpec` carries a pre-authored `barrierSegments` array of `{cx, cz, width, depth}` blocks. `Walls.tsx#Barrier` iterates the segments and renders each as a `boxGeometry` mesh of height `barrierHeight` using shared side/top materials. Adding or removing a doorway means updating the authored segments, not rerunning a runtime segmentation pass.

## localPlayerPos

`localPlayerPos.ts` exports a mutable `{ x, z, roomId }` object. `Player.tsx` writes to it every frame. `GameScene.tsx` reads it in `useFrame` for camera follow. When `CURRENT_MAP.getRoomAtPosition` returns a different `roomId`, `store.setCurrentRoomId` is also called to trigger JSX room-set updates.

## Vote Regions

`VoteRegions.tsx` reads `CURRENT_MAP.gameSpec.voteRegions` and renders each as a `<group>` at its world-space `(x, 0, z)` position. Each group contains three meshes flat on the XZ plane (all rotated `[-π/2, 0, 0]`):

1. **Fill disc** (`circleGeometry`, 64 segments) at Y = 0.002; `meshBasicMaterial` with the region colour, `transparent`, `opacity: 0.35`.
2. **Border ring** (`ringGeometry`, inner radius = `r * 0.9625`, outer = `r`, 64 segments) at Y = 0.003; opaque region colour.
3. **Label** (`Text` from `@react-three/drei`) at Y = 0.004; `fontSize: r * 0.8`, region colour, centred on both axes.

Only regions whose authored `(x, z)` resolves to a currently-visible room (via `CURRENT_MAP.getRoomAtPosition`) are rendered, keeping hidden rooms' markers out of view.

## Ground Texture

`Ground.tsx`: with a `FloorTextureSpec`, repeat = `fill_x ? fw/tile_width : tile_x_count` (same for Y). Without one: `Textures.fallbackGround()` with `repeat = (fw/4, fd/4)`.
