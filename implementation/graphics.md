# Graphics — Implementation

## Relevant Files

```
src/scene/
  Player.tsx            — Local player mesh and animation state
  RemotePlayers.tsx     — Remote player meshes with interpolated animation
  PlayerHudUpdater.tsx  — Projects remote player positions for heart overlay divs
src/hud/
  PlayerHudOverlay.tsx  — HP heart divs and elimination overlay; hudRegistry
src/store/
  gameStore.ts          — playerHp map keyed by player id
```

## Player Mesh

Each player renders as a capsule mesh. The mesh material colour is set from the player's assigned colour. Idle and walking states share the same geometry.

## Animation State

`animState` is `'idle'` or `'walking'`. The local player's state is updated in `Player.tsx` step 2 (prediction) from `update_animation_state` events returned by `world.processMove`. Remote players' state is updated in `RemotePlayerMesh.useFrame` from `update_animation_state` events consumed out of the 250 ms event buffer.

The walking blink is implemented as a repeating material opacity toggle on the player mesh.

## HP Heart Overlays

Heart overlays are HTML `<div>`s rendered outside the Canvas in `PlayerHudOverlay.tsx`, registered in `hudRegistry` (`Map<playerId, HTMLDivElement>`). Each frame, `Player.tsx` (local) and `PlayerHudUpdater.tsx` (remote) project the player's world position through the orthographic camera to screen-space pixel coordinates and write the result as a CSS `transform` on the registered div. `camera.updateMatrixWorld()` must be called before projecting, since Three.js only syncs `matrixWorldInverse` during `gl.render()`.

R3F `useFrame` priorities ensure the camera is positioned before hearts are projected: `GameScene` runs at priority `−2`, `PlayerHudUpdater` at `−1`, local `Player` at `0`.

Divs start `display: none` and become visible on the first frame a valid position is known. Remote player heart divs are conditionally mounted based on the `hasHealth` flag from `player_joined`.

## Elimination Overlay

The elimination overlay is a full-screen HUD element in `PlayerHudOverlay.tsx`, mounted when `playerHp[localPlayerId] === 0`.
