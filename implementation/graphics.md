# Graphics — Implementation

## Relevant Files

```
react-three-capacitor/src/scene/
  Player.tsx                  — Local player mesh and animation state; mounts HeartSprite as a child
  RemotePlayers.tsx           — Remote player meshes; conditionally mounts HeartSprite per player
  HeartSprite.tsx             — 3D sprite heart, half-heart canvas variant, world-space placement
  animation/CapsuleFallback.tsx — Capsule mesh + walking colour-blink animation
  GameScene.tsx               — Root scene; priority-ordered useFrame callbacks
react-three-capacitor/src/hud/
  EliminationOverlay.tsx      — Full-screen HTML overlay when local HP reaches 0
react-three-capacitor/src/store/
  gameStore.ts                — playerHp map keyed by player id
```

## Player Mesh

Each player renders as a capsule mesh from `CapsuleFallback`. The material colour is set from the player's assigned colour. Idle and walking states share the same geometry.

## Animation State

`animState` is `'IDLE'` or `'WALKING'` (uppercase). The local player's state is updated in `Player.tsx` step 2 (prediction) from `update_animation_state` events returned by `world.processMove`. Remote players' state is updated in `RemotePlayerMesh.useFrame` from `update_animation_state` events consumed out of the render-tick buffer.

The walking "blink" in `CapsuleFallback.tsx` toggles the mesh material **colour** (not opacity) at `BLINK_HZ = 8` between `#ffffff` and `#222222`. When `IDLE` the material resets to the assigned colour.

## HP Heart Sprites

Hearts are 3D `<sprite>` objects mounted as children of the player group, not HTML overlays. `HeartSprite.tsx` lazily builds two shared `THREE.CanvasTexture`s (full and half) using a 16×16 heart `Path2D`. The half-heart variant is drawn by clipping the canvas to `rect(0, 0, 8, 16)` before filling, leaving the right half unfilled but still stroked. Both textures are cached in module-scope so every player shares the same two textures.

The sprite is positioned in local space above the capsule top, with a small Z offset derived from `CAMERA_ANGLE` so the heart projects just below the capsule's feet on screen. Both `depthTest` and `depthWrite` are disabled on `spriteMaterial` so hearts never fight the ground or barrier geometry; layering between players is handled by setting the parent group's `renderOrder` to `1000 − cameraDistance` each frame in `Player.tsx` and `RemotePlayers.tsx`. Within a group the heart has `renderOrder = 1` so it paints over its own capsule but below any nearer-player capsule.

Hearts are conditional: the sprite returns `null` when `hp === 0`, and is only rendered for remote players whose `hasHealth` flag is true.

## R3F useFrame Priorities

`GameScene.tsx` uses the following `useFrame` priorities:
- `-3` — `advanceRenderTick(delta)` updates the shared `renderTickFloat` before any consumer reads it.
- `-2` — camera follow uses the freshly-advanced render tick and writes `camera.position`.
- `0` (default) — `Player` and `RemotePlayers` read the updated camera and render-tick to place meshes and hearts.

## Elimination Overlay

`EliminationOverlay.tsx` is a standalone HUD component mounted from `HUD.tsx`. It shows `ELIMINATED` (local player HP 0, reconnectable by tap) or `DISCONNECTED` (observer-mode end), full-screen at `z-index: 1000`.
