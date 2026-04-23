// CAMERA_ANGLE is from the vertical (Y axis): 0 = directly overhead, 90 = horizontal.
// At 25°: dy = D*cos(25°) ≈ 0.906D (mostly up), dz = D*sin(25°) ≈ 0.423D (slightly south).
export const CAMERA_ANGLE = 25 * (Math.PI / 180);

// Distance from camera target to camera position, in world units.
// 1 world unit = the ground-plane distance visible from screen top to bottom.
export const CAMERA_DIST = 5;
