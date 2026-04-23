import { useMemo } from 'react';
import * as THREE from 'three';
import type { RoomSpec } from '../game/RoomSpec';
import { Textures } from '../game/textures';

const FALLBACK_TILE = 0.32  // world units per fallback tile

export function Ground({ room }: { room: RoomSpec }) {
  const { floorWidth: fw, floorDepth: fd, floorTextures } = room
  const spec = floorTextures?.[0]

  const texture = useMemo(() => {
    if (!spec) {
      const t = Textures.fallbackGround()
      t.repeat.set(fw / FALLBACK_TILE, fd / FALLBACK_TILE)
      return t
    }

    const t = spec.imageUrl
      ? (() => { const l = new THREE.TextureLoader(); return l.load(spec.imageUrl!) })()
      : Textures.fallbackGround()

    t.wrapS = t.wrapT = THREE.RepeatWrapping
    const repX = spec.fill_x ? fw / spec.tile_width : spec.tile_x_count
    const repY = spec.fill_y ? fd / spec.tile_height : spec.tile_y_count
    t.repeat.set(repX, repY)
    return t
  }, [spec, fw, fd])

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[fw, fd]} />
      <meshLambertMaterial map={texture} />
    </mesh>
  )
}
