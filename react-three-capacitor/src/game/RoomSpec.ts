// North = -Z, South = +Z, East = +X, West = -X (Three.js floor-plane convention).
export type Wall = 'north' | 'south' | 'east' | 'west'

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
  floorWidth: number        // inner floor X extent (world units)
  floorDepth: number        // inner floor Z extent (world units)
  barrierHeight: number     // barrier Y extent
  barrierThickness: number  // barrier XZ thickness
  // 'full' = camera rect is the full room floor (use for narrow corridors where viewport-clamped formula degenerates to a point but per-axis tracking is still desired).
  // Omit  = viewport-constrained rect: max(0, dim/2 - halfViewDim) per axis.
  cameraRect?: 'full'
  floorTextures?: FloorTextureSpec[]
  outsideTextures?: OutsideTextureSpec[]
  geometry?: unknown[]      // future in-room objects
}
