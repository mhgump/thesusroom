# Scene — Implementation

## Relevant Files

```
src/scene/
  GameScene.tsx      — Root scene component; room rendering, camera, lighting
  Player.tsx         — Local player: world simulation, move dispatch, room tracking
  localPlayerPos.ts  — Mutable shared object { x, z, roomId } written each frame
src/game/
  DefaultWorld.ts    — Client-side world spec and WalkableArea computation
  WorldSpec.ts       — Room position BFS, walkable area computation, world types
  CameraConstraint.ts — buildCameraConstraintPoly, clampToPoly
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

`World.processMove` runs a three-pass collision check (full move → X-only → Z-only) against `inWalkable`, enabling wall-sliding. The client computes `WalkableArea` in `DefaultWorld.ts`; the server in `server/src/WorldLayout.ts`. The two must use identical constants.

## Room Rendering

`GameScene.tsx` reads `currentRoomId` from the Zustand store to determine which rooms to render: the active room plus its `visibility` list. Each room renders in a `<group>` at its world-space centre so `Ground`, `Barrier`, and `RoomOutsideTextures` use room-local coordinates.

## Camera Constraint Polygon

`CameraConstraint.ts` exports `buildCameraConstraintPoly` and `clampToPoly`.

Each room contributes a *camera rect*:
- **Default**: `txBound = max(0, floorWidth/2 − halfViewW)` — viewport stays inside room; degenerates to a point for rooms narrower than the viewport.
- **`cameraRect: 'full'`**: `txBound = floorWidth/2` — camera tracks the full room floor; used for narrow corridors.

Adjacent rects are bridged by trapezoids (south edge = north edge of southern rect, north edge = south edge of northern rect). The polygon walks east side south-to-north, then west side north-to-south. Consecutive duplicate vertices from degenerate shapes are removed.

`clampToPoly` projects the player position to the nearest point in the polygon each frame. The polygon is cached in a `useRef` in `GameScene.tsx` and rebuilt only on viewport resize.

## Barrier Wall Segmentation

`segmentWall(from, to, openings[])` in `Walls.tsx` returns solid intervals after cutting doorway openings. Each interval renders as a separate `BoxGeometry` mesh. E/W walls extend by `barrierThickness` past each floor end to cover corners, except when the corresponding N/S wall has openings — in that case the E/W wall is trimmed to the floor edge to prevent overlap into the adjacent room.

## localPlayerPos

`localPlayerPos.ts` exports a mutable `{ x, z, roomId }` object. `Player.tsx` writes to it every frame. `GameScene.tsx` reads it in `useFrame` for camera follow. When `getDefaultRoomAtPosition` returns a different `roomId`, `store.setCurrentRoomId` is also called to trigger JSX room-set updates.

## Ground Texture

`Ground.tsx`: with a `FloorTextureSpec`, repeat = `fill_x ? fw/tile_width : tile_x_count` (same for Y). Without one: `Textures.fallbackGround()` with `repeat = (fw/4, fd/4)`.
