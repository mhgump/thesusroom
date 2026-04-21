// Inner floor dimensions
export const ROOM_WIDTH = 20;
export const ROOM_DEPTH = 12;

export const WALL_HEIGHT = 4;
export const WALL_THICKNESS = 1;

// Outer dimensions (including walls)
export const OUTER_WIDTH = ROOM_WIDTH + WALL_THICKNESS * 2;
export const OUTER_DEPTH = ROOM_DEPTH + WALL_THICKNESS * 2;

// Camera: 25° downward from positive y-axis
export const CAMERA_ANGLE = 25 * (Math.PI / 180);

// Horizontal shear applied to east/west wall tops so inner faces face the camera
export const WALL_SKEW_AMOUNT = WALL_HEIGHT * Math.tan(CAMERA_ANGLE);

// Asymmetric frustum extents aligned to scene edges:
//   FRUSTUM_TOP    = far edge of north wall top face in screen-Y
//   FRUSTUM_BOTTOM = bottom edge of south wall in screen-Y (positive magnitude)
//   FRUSTUM_H      = total vertical screen extent
//   FRUSTUM_W      = total horizontal extent (outer top edges of east/west walls after shear)
export const FRUSTUM_TOP = (OUTER_DEPTH / 2) * Math.cos(CAMERA_ANGLE);
export const FRUSTUM_BOTTOM =
  WALL_HEIGHT * Math.sin(CAMERA_ANGLE) + (OUTER_DEPTH / 2) * Math.cos(CAMERA_ANGLE);
export const FRUSTUM_H = FRUSTUM_TOP + FRUSTUM_BOTTOM;
export const FRUSTUM_W = OUTER_WIDTH + 2 * WALL_SKEW_AMOUNT;

// Camera fit config:
// Normally the camera zooms so that one pair of room edges locks to screen edges and
// the other pair is cropped. SCENE_MIN_BORDER (world units) is the minimum visible
// half-extent on the cropped axis before the letterbox fallback kicks in.
// 0 = always zoom-in; FRUSTUM_W/2 or FRUSTUM_H/2 ≈ always letterbox.
export const SCENE_MIN_BORDER = 0;

// Ground plane extends this many world units beyond the outer walls on every side.
export const GROUND_EXTRA = ROOM_WIDTH;
