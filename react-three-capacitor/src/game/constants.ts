// CAMERA_ANGLE is from the vertical (Y axis): 0 = directly overhead, 90 = horizontal.
// At 25°: dy = D*cos(25°) ≈ 0.906D (mostly up), dz = D*sin(25°) ≈ 0.423D (slightly south).
export const CAMERA_ANGLE = 25 * (Math.PI / 180);
export const CAMERA_DIST = 60;

// World units the camera viewport spans horizontally (fixed-width frustum).
export const VIEWPORT_W = 20;

// Full ground-plane extent of the viewport at 16:9.
//   VIEWPORT_DEPTH = (VIEWPORT_W / (16/9)) / cos(CAMERA_ANGLE) ≈ 12.41
// ROOM_* are the 0.75× reference room size used for Room 1 and as a unit of measure.
export const VIEWPORT_DEPTH = (VIEWPORT_W / (16 / 9)) / Math.cos(CAMERA_ANGLE);      // ≈ 12.41
export const ROOM_WIDTH = VIEWPORT_W * 0.75;                                           // 15
export const ROOM_DEPTH = VIEWPORT_DEPTH * 0.75;                                       // ≈ 9.31
