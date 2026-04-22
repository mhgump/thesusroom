# Scene — Spec

- A world defines a collection of rooms and the connections between them.
- Rooms are positioned in world space based on their connections; the first room is placed at the origin.
- A connection defines a doorway between two rooms: the wall of each room the doorway opens on, its position along those walls, and its width.
- A world defines which adjacent rooms are visible from each room.
- A room defines a rectangular floor area with surrounding low barriers and optional floor and exterior textures.
- Barrier geometry wraps the room perimeter with openings cut for each doorway; corner blocks are suppressed at walls with connections so barrier geometry does not extend into adjacent rooms.
- The floor shows a tiled texture; if no texture is specified a fallback texture is used.
- Exterior planes render beyond room walls.
- An orthographic camera follows the local player.
- Camera movement is bounded by a precomputed region: each room contributes a camera rect (default: largest rect keeping the viewport inside the room; narrow corridors may opt into full-floor tracking), and adjacent rects are bridged by trapezoids.
- The camera centre is the player position when inside the region, or the nearest boundary point when outside.
- Camera position is continuous across all rooms — no sudden jumps occur when crossing room boundaries.
- The scene has ambient and directional lighting with shadows.
