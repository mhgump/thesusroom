# Spec

- A world defines a collection of rooms and the connections between them.
- Rooms are positioned in world space based on their connections; the first room is placed at the origin.
- A connection defines a doorway between two rooms, specifying which wall of each room it opens on, its position along those walls, and its width.
- A world defines which adjacent rooms are visible from each room.
- A room defines a rectangular floor area with surrounding low barriers and optional floor and exterior textures.
- Barrier geometry wraps the room perimeter with openings cut for each doorway. At walls with connections, the corner blocks are suppressed so barrier geometry does not extend into adjacent rooms.
- The floor shows a tiled texture. If no texture is specified, a fallback texture is used.
- Exterior planes render beyond room walls, above the background layer.
- An orthographic camera follows the local player. Camera movement is bounded by a precomputed region: each room contributes a camera rect (by default, the largest rect such that the viewport stays inside the room; narrow corridors may opt into full-floor tracking), and adjacent rects are bridged by trapezoids. The camera center is the player position when inside the region, or the nearest boundary point when outside. Camera position is continuous across all rooms.
- Ambient and directional lighting with shadows.
- Each player is represented as a capsule-shaped figure. The idle state shows the player's color; the walking state has a blink animation.
- Each player has a health value between 0 and 2. Full health shows a full heart at the player's feet, half health shows a half heart, and zero health shows no heart. A local player at zero health sees an elimination overlay.

---

# Implementation

## Coordinate system

X = east (+right), Y = up, Z = south (+toward camera). Floor at Y = 0. North = −Z, South = +Z.

## Room positions (`WorldSpec.computeRoomPositions`)

BFS from `rooms[0]` at origin. For each connection from a known room to an unknown one, the door center is computed in world space from the known room's wall edge, then the unknown room's center is back-solved from that door point and its own wall/positionB. Rooms remain in world space for all downstream logic (rendering, physics, camera).

## Walkable area physics (`WorldSpec.computeWalkableArea`, `World.ts`)

`WalkableArea` is a precomputed list of axis-aligned rects (inset by `CAPSULE_RADIUS`):
- One rect per room floor.
- One thin corridor per connection at the shared floor edge: half-width = `doorWidth/2 − r`, half-depth = `r`.

`World.processMove` replaces clamp-to-bounds with a three-pass check (full move → X-only → Z-only) against `inWalkable`, enabling wall-sliding across multi-room geometry.

`WalkableArea` is computed independently by the client (`DefaultWorld.ts`) and server (`WorldLayout.ts`) using identical constants. They must stay in sync.

## Room rendering (`GameScene.tsx`)

`currentRoomId` from the Zustand store (updated by `Player.tsx` on room change) determines which rooms to render: the active room plus its `visibility` list. Each room renders in a `<group>` positioned at its world-space center, so `Ground`, `Barrier`, and `RoomOutsideTextures` all use room-local coordinates.

## Camera constraint polygon (`CameraConstraint.ts`, `GameScene.tsx`)

The camera target is constrained to a precomputed polygon that covers all rooms and their transitions, so the camera never snaps when the player crosses a room boundary. The polygon is not required to be convex — room chains with varying widths produce concave shapes.

**Building the polygon (`buildCameraConstraintPoly`):**

Each room contributes a *camera rect* — an axis-aligned rectangle of allowed camera-center positions:

```
Default (cameraRect omitted):
  txBound = max(0, floorWidth/2  − halfViewW)
  tzBound = max(0, floorDepth/2  − halfViewGroundZ)
  → viewport-constrained: camera center stays within room so viewport never exceeds the room floor.
  → degenerates to a point when the room is smaller than the viewport in both dimensions (e.g. Room 1).

cameraRect: 'full':
  txBound = floorWidth/2
  tzBound = floorDepth/2
  → full room floor: camera center tracks anywhere in the room (viewport may show exterior).
  → use for narrow corridors where the viewport-constrained formula collapses to a point but
    per-axis tracking is still desired (e.g. Room 2).
```

Adjacent rects are bridged by trapezoids whose south edge is the north edge of the southern rect and whose north edge is the south edge of the northern rect. Trapezoids degenerate to triangles or line segments for point rects. The polygon is built by walking the east side south-to-north then the west side north-to-south. Consecutive duplicate vertices from degenerate shapes are removed.

**Per-frame clamping (`clampToPoly`):**

The player position is projected to the nearest point in the polygon each frame. Points inside are unchanged; points outside are moved to the nearest edge. This is continuous — switching rooms never causes a position discontinuity because the polygon is global and fixed.

The polygon is cached in a `useRef` and rebuilt only when `cam.right` or `cam.top` change (window resize).

Camera rotation is set once on mount and never changed — only `cam.position` updates per frame.

## Barrier wall segmentation (`Walls.tsx`)

`segmentWall(from, to, openings[])` returns the solid intervals remaining after cutting doorway openings. Each interval renders as a separate `BoxGeometry` mesh.

North/south walls span the inner floor width. East/west walls normally extend by `barrierThickness` past each floor end to cover corners. When a north or south wall has openings (i.e., a connection exists on that side), the corresponding east/west wall end is trimmed to the floor edge instead, preventing the corner block from overlapping the adjacent room.

## `localPlayerPos` (`localPlayerPos.ts`)

Mutable object `{ x, z, roomId }` written by `Player.tsx` every frame. `GameScene.tsx` reads it in `useFrame` for camera follow. `roomId` is updated when `getDefaultRoomAtPosition` returns a different room; at that point `store.setCurrentRoomId` is also called to trigger reactive room-rendering updates.

## HP indicator rendering

Heart groups live at scene root (not inside the capsule group). Each player's `useFrame` sets the heart group's position directly after setting the capsule position. This keeps both in the same frame callback, so drei's `Html` reads the freshly-set position rather than relying on a separate useFrame to propagate the matrix. Hearts start hidden (`display: none` on the wrapper div) and are revealed on the first frame that a valid position is known.

For remote players, drei's `Html` respects the position of its parent group but does not check Three.js `visible`. Visibility is controlled by setting `display` on the wrapper div directly.

## Ground texture (`Ground.tsx`)

With a `FloorTextureSpec`: repeat = `fill_x ? fw/tile_width : tile_x_count` (same for Y). Without one: `Textures.fallbackGround()` with `repeat = (fw/4, fd/4)`.

---

# Expectations

- **`DefaultWorld.ts` and `server/src/WorldLayout.ts` must encode the same walkable rects.** They are computed independently (server has no access to client source). Any change to room dimensions or connections requires updating both.
- **`CAPSULE_RADIUS = 0.35` appears in `World.ts` (both copies) and as `CAPSULE_RADIUS` in `DefaultWorld.ts`.** All three must agree — this value is embedded in the precomputed `WalkableArea` rects.
- **Camera rotation never changes after mount.** Do not call `cam.lookAt` in the per-frame path.
- **The camera constraint polygon is rebuilt only on viewport resize** (`cam.right` or `cam.top` changes). Per-frame rebuilds are unnecessary; the polygon shape depends only on viewport dimensions and the static world layout.
- **Adding a room requires no camera configuration by default.** The viewport-constrained formula applies automatically. Set `cameraRect: 'full'` on narrow corridor rooms (narrower than the viewport) where per-axis tracking within the room is desired. The polygon builder (`chainSouthToNorth`) follows north-wall connections, so rooms must form a linear north-south chain for the polygon to cover all of them.
- **Barrier openings are derived from `WorldSpec.connections` at render time**, not stored on the `RoomSpec`. Changing a connection automatically updates the gap in both rooms' barriers, and trims the adjacent E/W wall ends accordingly.
- **E/W walls stop at the floor edge on N/S-connected sides.** The corner block is suppressed whenever the N/S wall has any opening; this prevents barrier geometry from overlapping adjacent rooms.
- **`currentRoomId` in the store lags one frame behind `localPlayerPos.roomId`.** The store triggers JSX re-renders (room set changes); `localPlayerPos.roomId` is used in `useFrame` (camera) which runs before React reconciliation. Use the store for rendering, `localPlayerPos.roomId` for per-frame logic.
- **Y-layer order: −0.01 (bg plane) < 0 (floor) < 0.005 (outside textures).** Do not collapse these — z-fighting will appear.
- **`gameStore.playerHp` is keyed by player ID for all players (local and remote).** The local player's HP is seeded from the `welcome` message; remote players' from `player_joined`. Both are cleaned up when a player disconnects (`removeRemotePlayer` deletes the key).
- **SVG `clipPath` IDs in `HeartHalf` use React's `useId()`**, which generates stable, instance-unique IDs. Do not replace with static strings — multiple hearts on screen would share the same clip region.
