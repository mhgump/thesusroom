import { useMemo } from 'react';
import * as THREE from 'three';
import type { RoomSpec } from '../game/RoomSpec';
import { Textures } from '../game/textures';

function makeMaterials(): THREE.Material[] {
  const side = new THREE.MeshLambertMaterial({ map: Textures.barrierSide() });
  const top = new THREE.MeshLambertMaterial({ map: Textures.barrierTop() });
  const hidden = new THREE.MeshLambertMaterial({ visible: false });
  // BoxGeometry face order: +X, -X, +Y (top), -Y, +Z, -Z
  return [side, side, top, hidden, side, side];
}

interface BarrierProps {
  room: RoomSpec
}

export function Barrier({ room }: BarrierProps) {
  const { barrierHeight: bh } = room
  const mats = useMemo(makeMaterials, [])

  return (
    <group>
      {(room.barrierSegments ?? []).map((seg, i) => (
        <mesh key={i} material={mats} position={[seg.cx, bh / 2, seg.cz]} castShadow receiveShadow>
          <boxGeometry args={[seg.width, bh, seg.depth]} />
        </mesh>
      ))}
    </group>
  )
}
