# Scene — Implementation

## Relevant Files

```
react-three-capacitor/src/scene/
  GameScene.tsx      — Root scene component; room rendering, camera, lighting
  Player.tsx         — Local player: world simulation, move dispatch, room tracking
  RemotePlayers.tsx  — Remote player meshes; per-player visibility vs. current room
  Ground.tsx         — Floor mesh with texture tiling
  Walls.tsx          — Barrier mesh built from per-room pre-authored barrier segments
  Boundary.tsx       — BgPlane, RoomOutsideTextures
  VoteRegions.tsx    — Renders vote region discs, border rings, and text labels
  GeometryLayer.tsx  — Renders toggleable floor-geometry objects
  ButtonLayer.tsx    — Renders map buttons
react-three-capacitor/src/game/
  WorldSpec.ts       — Room position BFS, walkable area computation, world types, scoping helpers
  MapInstance.ts     — buildMapInstanceArtifacts: scoped-id artifacts for a WorldSpec under a mapInstanceId
  GameMap.ts         — GameMap interface (mapInstanceId, scoped roomPositions, scoped lookups)
  RoomSpec.ts        — RoomSpec and RoomConnection type definitions (including barrierSegments)
  CameraConstraint.ts — buildCameraConstraintShapes, clampToShapes
  World.ts           — Shared physics simulation; per-player room + accessibility bookkeeping
  localPlayerPos.ts  — Mutable shared object { x, z, roomId } written each frame
content/maps/
  demo.ts            — Demo map: DEMO_WORLD_SPEC, MAP_INSTANCE_ID='demo', camera shapes, DEMO_GAME_SPEC
  scenario{1..4}.ts  — Per-scenario maps; each sets MAP_INSTANCE_ID equal to its scenario id
  index.ts           — Exports CURRENT_MAP resolved from CURRENT_SCENARIO_ID
content/server/maps/
  demo.ts            — Server-side demo map spec (walkable rects, physics geometry)
  scenario{1..4}.ts  — Per-scenario server map specs
```

## Map Instance and Scoping

A `GameMap` is a static definition; a world instance instantiates it under a `mapInstanceId` to produce scoped room ids of the form `{mapInstanceId}_{localRoomId}`. Scoping happens at the map boundary: inside each map file, rooms and visibility use local ids; at the `GameMap` boundary every room id crossing to the world, client store, or wire is scoped.

`WorldSpec.ts` exports the helpers `scopedRoomId(mid, localId)`, `unscopeRoomId(scopedId, mid)`, and `roomsOverlap(a, posA, b, posB)`. `MapInstance.ts#buildMapInstanceArtifacts(spec, mapInstanceId)` consumes a local `WorldSpec` and returns:

- `roomPositions`: `Map<scopedId, RoomWorldPos>` — local BFS positions re-keyed by scoped id.
- `getRoomAtPosition(x, z)`: scoped id or `null` — delegates to the local `getRoomAtPosition` and scopes the result.
- `getAdjacentRoomIds(scopedId)`: scoped neighbours from `spec.visibility` (keys and values scoped at build time).
- `isRoomOverlapping(scopedId)`: true iff the local room intersects another in the same `WorldSpec` — always false in the current one-map-per-world deployment.
- `scopedRoomIds`: the full scoped-id list.

Each file in `content/maps/*.ts` sets a `MAP_INSTANCE_ID` string (equal to its scenario id), calls `validateWorldSpec` on the local `WorldSpec`, calls `buildMapInstanceArtifacts`, and wires `mapInstanceId`, `roomPositions`, `getRoomAtPosition`, `getAdjacentRoomIds`, and `isRoomOverlapping` into its exported `GameMap`. Camera shapes are still computed from the **local-id** positions (`buildCameraConstraintShapes(spec, localPositions)`), since authored camera rects and transition zone corners are in room-local coordinates keyed by local ids.

## Room Positioning

`WorldSpec.computeRoomPositions` runs BFS from `rooms[0]` at the origin. For each connection from a known room to an unknown one, the door centre is computed in world space from the known room's wall edge, then the unknown room's centre is back-solved from that point. `buildMapInstanceArtifacts` re-keys the resulting positions under scoped ids for `GameMap.roomPositions`.

## Walkable Area Physics

`WalkableArea` is a list of axis-aligned rects authored per map. In AABB mode, `World.processMove` runs a three-pass collision check (full move → X-only → Z-only) against `inWalkable`, enabling wall-sliding. In Rapier mode (maps that provide a `PhysicsSpec`), walls and toggleable geometry are registered as colliders and the Rapier `KinematicCharacterController` enforces collision continuously; `WalkableArea` is still retained as a fallback snap target when variants switch.

Walkable rects are authored in `content/maps/*.ts` (client) and `content/server/maps/*.ts` (server); the two copies must use identical constants.

## Room Rendering

`GameScene.tsx` decides which rooms to render from the scoped `currentRoomId`:

1. Candidate set = `[currentRoomId, ...CURRENT_MAP.getAdjacentRoomIds(currentRoomId)]`.
2. Filter via `isRoomVisible(scopedId)`:
   - If `playerRoomVisibilityOverride[scopedId]` is defined, use that verbatim.
   - Else if `CURRENT_MAP.isRoomOverlapping(scopedId)` and `scopedId !== currentRoomId`, hide.
   - Else render unless `roomVisibility[scopedId] === false`.
3. Iterate `CURRENT_MAP.worldSpec.rooms` (local ids) and keep rooms whose scoped id `` `${CURRENT_MAP.mapInstanceId}_${room.id}` `` is in the visible set.

Each surviving room renders in a `<group>` positioned at `CURRENT_MAP.roomPositions.get(scopedId)` so `Ground`, `Barrier`, and `RoomOutsideTextures` work in room-local coordinates.

`RemotePlayers.tsx` uses the same scoped-id visibility set (`{currentRoomId} ∪ getAdjacentRoomIds(currentRoomId)`) and hides a remote player whose position falls inside any non-visible room's floor rectangle. Corridor positions (outside every floor) stay visible.

`HUD.tsx` strips the `{mapInstanceId}_` prefix from `currentRoomId` before looking up the room's `name` in `worldSpec.rooms`, which is keyed by local id.

## Camera Constraint Shapes

`CameraConstraint.ts` exports `buildCameraConstraintShapes` and `clampToShapes`. Each map module calls `buildCameraConstraintShapes(WORLD_SPEC, LOCAL_POSITIONS)` at load time — before scoping — because the authored rects and corners are local-coordinate.

`buildCameraConstraintShapes(spec, localPositions)` converts authored specs to world-space shapes:
- **Rects**: each room's `cameraRect` (room-local `{ xMin, xMax, zMin, zMax }`) is offset by the room's world-space centre to produce a world-space `CameraRect`. Rooms without an authored `cameraRect` default to a point at the room centre.
- **Zones**: each connection's `cameraTransition.corners` (in room-A-local coordinates) are offset by room A's world position to produce world-space `CameraZone` polygons.

The camera shapes are computed once at map module load time (e.g. `DEMO_CAMERA_SHAPES` in `content/maps/demo.ts`) and reused every frame.

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

`localPlayerPos.ts` exports a mutable `{ x, z, roomId }` object. `roomId` starts as the empty string and is populated with a scoped id the first time the player's position resolves to a room via `CURRENT_MAP.getRoomAtPosition` (which already returns scoped ids). `Player.tsx` writes to `localPlayerPos` every frame; when `getRoomAtPosition` returns a new scoped id, it also calls `store.setCurrentRoomId(newRoomId)` to trigger JSX room-set updates. `GameScene.tsx` reads `localPlayerPos` in `useFrame` for camera follow.

## Vote Regions

`VoteRegions.tsx` reads `CURRENT_MAP.gameSpec.voteRegions` and renders each as a `<group>` at its world-space `(x, 0, z)` position. Each group contains three meshes flat on the XZ plane (all rotated `[-π/2, 0, 0]`):

1. **Fill disc** (`circleGeometry`, 64 segments) at Y = 0.002; `meshBasicMaterial` with the region colour, `transparent`, `opacity: 0.35`.
2. **Border ring** (`ringGeometry`, inner radius = `r * 0.9625`, outer = `r`, 64 segments) at Y = 0.003; opaque region colour.
3. **Label** (`Text` from `@react-three/drei`) at Y = 0.004; `fontSize: r * 0.8`, region colour, centred on both axes.

Only regions whose authored `(x, z)` resolves (via `CURRENT_MAP.getRoomAtPosition`) to a currently-visible scoped room id are rendered, keeping hidden rooms' markers out of view.

## Ground Texture

`Ground.tsx`: with a `FloorTextureSpec`, repeat = `fill_x ? fw/tile_width : tile_x_count` (same for Y). Without one: `Textures.fallbackGround()` with `repeat = (fw/4, fd/4)`.
