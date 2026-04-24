// North = -Z, South = +Z, East = +X, West = -X (Three.js floor-plane convention).
export type Wall = 'north' | 'south' | 'east' | 'west'

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
//   x: fill_x ? floorWidth / tile_width : tile_x_count
//   y: fill_y ? floorDepth / tile_height : tile_y_count
// A single texture covering the whole floor: (floorWidth, floorDepth, 1, 1, false, false)
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
  // Inner floor extents and room Y-extent (world units). The room's bounding
  // cube is `floorWidth × height × floorDepth` centred at `(0, height/2, 0)`
  // in room-local coordinates. All geometry entries must fit inside this cube.
  floorWidth: number
  floorDepth: number
  height: number
  // Designer-specified camera rect in room-local coordinates (origin at room centre).
  // The camera is constrained to this rect while the player is in this room.
  // If absent, defaults to a point at the room centre (camera stays fixed).
  cameraRect?: { xMin: number; xMax: number; zMin: number; zMax: number }
  geometry?: GeometrySpec[]
  floorTextures?: FloorTextureSpec[]
  outsideTextures?: OutsideTextureSpec[]
}
