// ── Migration notes (Task 1: data-shape only) ────────────────────────────────
// The RoomSpec shape was migrated to the user-spec target:
//   { id, name?, x?, y?, cameraExtentX, cameraExtentY, transitionType, height,
//     floorWidthX, floorDepthY, geometry?, floorTextures?, outsideTextures? }
//
// Decisions:
//   1. floorWidth/floorDepth: kept as separate fields, renamed
//      `floorWidthX` and `floorDepthY`. The previous codebase had several
//      maps where the camera rect did NOT match the floor extents (e.g.
//      prod_gates corridor: floor 0.5×1.25, camera 0×0.75 in z; scenario1
//      main: floor 1.6×0.75, camera 0.8×0 in x; many small rooms with
//      point cameras inside larger floors). Deriving floor extents from
//      camera extents would lose information, so option (B) — keep them
//      separate — was required.
//   2. x, y: optional. When absent, the world-space room position is
//      BFS-derived from `connections` as before (option B). Authors may
//      pin a room by setting both `x` and `y` explicitly; runtime code
//      treats explicit values as identical to derived ones today (no
//      cross-validation yet — Task 2+ may add that). Coordinates are
//      world-space x (east+) and y (south+, mapped to Three.js +Z).
//   3. cameraRect → cameraExtentX, cameraExtentY: HALF-extents, centered
//      on the room. The previous `cameraRect` allowed asymmetric
//      offsets (e.g. scenario2 room3 z-range 0.125..0.375 — north-biased,
//      not centered). Two such rooms existed; their migrated extents are
//      `max(|min|, |max|)` so the camera can still reach every position
//      it could before, at the cost of also being able to pan toward
//      the opposite extreme (a small behavior expansion, not a removal).
//      Authors can re-tune if needed.
//   4. transitionType: a new field, currently a single-member string
//      union `'default'`. Future tasks (per the user's roadmap) will
//      extend this union to drive RoomManager behavior — extend the
//      `TransitionType` union below as new variants are added.

// North = -Z, South = +Z, East = +X, West = -X (Three.js floor-plane convention).
export type Wall = 'north' | 'south' | 'east' | 'west'

// Per-room transition behavior. Single-member union for now; future tasks
// will extend this to drive RoomManager logic (Task 2+). Authors who don't
// care can omit it (defaults to 'default' at the call site if needed) — the
// type is required on RoomSpec, so every room must declare a value.
export type TransitionType = 'default'

// A 3D axis-aligned rectangular prism, authored in room-local coordinates
// (origin at room centre, +Y = up, floor at y=0). All geometry in the world —
// walls, obstacles, toggleable doors, floor decorations — is represented as
// GeometrySpec. Rapier treats every piece as a solid collider projected onto
// the XZ plane (centre `(cx, cz)`, half-extents `(width/2, depth/2)`); `cy`
// and `height` are for the 3D renderer only. Scenarios may toggle individual
// pieces on/off per-id (globally or per-player).
export interface GeometrySpec {
  id: string
  cx: number; cy: number; cz: number
  width: number; height: number; depth: number
  color?: string
  imageUrl?: string
}

// Grid-aligned floor texture.
// Repeat counts derived at render time:
//   x: fill_x ? floorWidthX / tile_width : tile_x_count
//   y: fill_y ? floorDepthY / tile_height : tile_y_count
// A single texture covering the whole floor: (floorWidthX, floorDepthY, 1, 1, false, false)
export interface FloorTextureSpec {
  imageUrl?: string
  color?: string
  tile_width: number
  tile_height: number
  tile_x_count: number
  tile_y_count: number
  fill_x: boolean
  fill_y: boolean
}

// Texture placed in the exterior space beyond a room wall.
// positionAlong: 0..1 fraction along the wall
//   N/S walls: 0 = west end, 1 = east end
//   E/W walls: 0 = north end, 1 = south end
// parallelWidth: world units parallel to the wall
// outwardDepth: world units perpendicular to the wall, extending outward
export interface OutsideTextureSpec {
  wall: Wall
  positionAlong: number
  parallelWidth: number
  outwardDepth: number
  color?: string
  imageUrl?: string
}

export interface RoomSpec {
  id: string
  name?: string
  // Optional explicit world-space room position. When omitted, the position
  // is BFS-derived from `connections` (the current default behavior). The
  // y axis here is the floor-plane axis (mapped to Three.js +Z).
  x?: number
  y?: number
  // Inner floor extents (world units). The room's bounding cube is
  // `floorWidthX × height × floorDepthY` centred at `(0, height/2, 0)` in
  // room-local coordinates. All geometry entries must fit inside this cube.
  floorWidthX: number
  floorDepthY: number
  height: number
  // HALF-extents of the room's camera rect, centred on the room centre.
  // The camera is constrained to a `[-cameraExtentX, +cameraExtentX] ×
  // [-cameraExtentY, +cameraExtentY]` rect in room-local coordinates while
  // the player is in this room. May be 0 (point) or with one axis 0 (line).
  cameraExtentX: number
  cameraExtentY: number
  // Per-room transition setting. Currently a placeholder for future tasks.
  transitionType: TransitionType
  geometry?: GeometrySpec[]
  floorTextures?: FloorTextureSpec[]
  outsideTextures?: OutsideTextureSpec[]
}
