# Graphics — Assumptions

- Player colour is randomised, not drawn from a fixed palette. `Room.pickColor()` generates 300 random HSL candidates (`h ∈ [0, 360)`, `s ∈ [0.65, 1.0]`, `l ∈ [0.38, 0.60]`), converts each to RGB, and picks the one whose minimum distance from any already-used colour is largest (using a perception-weighted RGB distance: `sqrt(2·dr² + 4·dg² + 3·db²)`). The first player gets the first candidate unconditionally.
- NPCs are assigned the fixed colour `#888888` and do not participate in the random-player-colour selection.
- Half-heart rendering uses canvas `clipRect(0, 0, 8, 16)` on a 16-unit heart `Path2D` — filling only the left half and stroking the outline over the full shape. The resulting `THREE.CanvasTexture` is shared across all players via module-level caches; there are only ever two heart textures allocated in the whole app (full + half).
- Heart sprites disable both `depthTest` and `depthWrite`; player-vs-player occlusion is faked by writing the parent group's `renderOrder = 1000 − cameraDistance` every frame.
- The walking colour-blink cycles at `BLINK_HZ = 8` between `#ffffff` and `#222222`; it mutates the shared `MeshLambertMaterial.color` in place rather than swapping materials.
