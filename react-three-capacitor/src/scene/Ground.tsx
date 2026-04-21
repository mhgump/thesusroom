import { useMemo } from 'react';
import { Textures } from '../game/textures';
import { ROOM_WIDTH, ROOM_DEPTH, OUTER_WIDTH, OUTER_DEPTH, GROUND_EXTRA } from '../game/constants';

// Tile size in world units, derived from the original texture repeat over the inner floor.
const TILE_SIZE = ROOM_WIDTH / 5; // = 4 world units (matches Textures.ground repeat 5,3)

const GROUND_W = OUTER_WIDTH + 2 * GROUND_EXTRA;
const GROUND_D = OUTER_DEPTH + 2 * GROUND_EXTRA;

export function Ground() {
  const texture = useMemo(() => {
    const t = Textures.ground();
    t.repeat.set(GROUND_W / TILE_SIZE, GROUND_D / TILE_SIZE);
    return t;
  }, []);

  return (
    // Plane defaults to XY; rotate around X to lay flat in XZ
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[GROUND_W, GROUND_D]} />
      <meshLambertMaterial map={texture} />
    </mesh>
  );
}
