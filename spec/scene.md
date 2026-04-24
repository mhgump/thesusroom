# Scene — Spec

- A world defines a collection of rooms and the connections between them.
- Rooms are positioned in world space based on their connections; the first room is placed at the origin.
- A connection defines a doorway between two rooms: the wall of each room the doorway opens on, its position along those walls, and its width.
- A world defines which adjacent rooms are visible from each room.
- A room defines a rectangular floor area with surrounding low barriers and optional floor and exterior textures.
- Barrier geometry wraps the room perimeter with openings for each doorway and does not extend into adjacent rooms.
- The floor shows a tiled texture; if no texture is specified a fallback texture is used.
- Exterior planes render beyond room walls.
- An orthographic camera follows the local player.
- Each room defines an explicit camera rect; each connection between rooms defines an explicit transition zone (a convex polygon bridging the two rooms' camera rects).
- Camera movement is bounded by the union of all room camera rects and transition zones.
- The camera centre is the player position when inside the union, or the nearest boundary point when outside.
- The camera approaches its constrained target position smoothly rather than snapping instantly; boundary crossings and physics noise near edges do not cause visible jitter.
- Camera position is continuous across all rooms — no sudden jumps occur when crossing room boundaries.
- The scene has ambient and directional lighting with shadows.
- Vote regions defined in the game spec are rendered as coloured circles on the floor, each with a text label centred inside the disc.
