import { useMemo } from 'react';
import * as THREE from 'three';
import { Textures } from '../game/textures';
import {
  ROOM_WIDTH,
  ROOM_DEPTH,
  WALL_HEIGHT,
  WALL_THICKNESS,
  WALL_SKEW_AMOUNT,
} from '../game/constants';

const hy = WALL_HEIGHT / 2;
const hw = ROOM_WIDTH / 2;
const hd = ROOM_DEPTH / 2;
const ht = WALL_THICKNESS / 2;

// Uniform X-shear for east/west walls and corner pillars.
function makeSideWallGeo(
  thickness: number,
  height: number,
  depth: number,
  topShiftX: number,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(thickness, height, depth);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + height / 2) / height;
    pos.setX(i, pos.getX(i) + t * topShiftX);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Trapezoid shear for N/S walls: spans exactly ROOM_WIDTH (no corner overlap).
// xFrac is linear ±1 across the inner width so both top corners reach
// ±(ROOM_WIDTH/2 + WALL_SKEW_AMOUNT), matching the E/W inner face tops.
function makeNorthSouthWallGeo(): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(ROOM_WIDTH, WALL_HEIGHT, WALL_THICKNESS);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + WALL_HEIGHT / 2) / WALL_HEIGHT;
    const xFrac = pos.getX(i) / hw; // −1 at left edge, +1 at right edge
    pos.setX(i, pos.getX(i) + t * xFrac * WALL_SKEW_AMOUNT);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export function Walls() {
  const tex = useMemo(() => Textures.wallInner(), []);

  // E/W walls span ROOM_DEPTH only — corners are left to pillars.
  const eastGeo = useMemo(
    () => makeSideWallGeo(WALL_THICKNESS, WALL_HEIGHT, ROOM_DEPTH, +WALL_SKEW_AMOUNT),
    [],
  );
  const westGeo = useMemo(
    () => makeSideWallGeo(WALL_THICKNESS, WALL_HEIGHT, ROOM_DEPTH, -WALL_SKEW_AMOUNT),
    [],
  );

  // N/S walls span ROOM_WIDTH only — corners are left to pillars.
  const northSouthGeo = useMemo(() => makeNorthSouthWallGeo(), []);

  // Pillars are WALL_THICKNESS³ sheared boxes.
  // −X face: floor x=±hw → ceiling x=±(hw+WALL_SKEW_AMOUNT)  — matches E/W inner face
  // ±Z face: at z=±hd                                         — matches N/S inner face
  // +X face: floor x=±(hw+WALL_THICKNESS)                     — matches E/W outer face
  // ∓Z face: at z=±(hd+WALL_THICKNESS)                        — matches N/S outer face
  const eastPillarGeo = useMemo(
    () => makeSideWallGeo(WALL_THICKNESS, WALL_HEIGHT, WALL_THICKNESS, +WALL_SKEW_AMOUNT),
    [],
  );
  const westPillarGeo = useMemo(
    () => makeSideWallGeo(WALL_THICKNESS, WALL_HEIGHT, WALL_THICKNESS, -WALL_SKEW_AMOUNT),
    [],
  );

  return (
    <group>
      {/* North wall (−Z): inner face at z=−hd, spans x=[−hw, +hw] */}
      <mesh geometry={northSouthGeo} position={[0, hy, -(hd + ht)]} castShadow receiveShadow>
        <meshLambertMaterial map={tex} />
      </mesh>

      {/* South wall (+Z): inner face at z=+hd, spans x=[−hw, +hw] */}
      <mesh geometry={northSouthGeo} position={[0, hy, +(hd + ht)]} castShadow receiveShadow>
        <meshLambertMaterial map={tex} />
      </mesh>

      {/* East wall (+X): inner face at x=+hw (floor), spans z=[−hd, +hd] */}
      <mesh geometry={eastGeo} position={[+(hw + ht), hy, 0]} castShadow receiveShadow>
        <meshLambertMaterial map={tex} />
      </mesh>

      {/* West wall (−X): inner face at x=−hw (floor), spans z=[−hd, +hd] */}
      <mesh geometry={westGeo} position={[-(hw + ht), hy, 0]} castShadow receiveShadow>
        <meshLambertMaterial map={tex} />
      </mesh>

      {/* Corner pillars (white) — fill the WALL_THICKNESS² corner squares */}
      <mesh geometry={eastPillarGeo} position={[+(hw + ht), hy, -(hd + ht)]} castShadow receiveShadow>
        <meshBasicMaterial color="white" />
      </mesh>
      <mesh geometry={westPillarGeo} position={[-(hw + ht), hy, -(hd + ht)]} castShadow receiveShadow>
        <meshBasicMaterial color="white" />
      </mesh>
      <mesh geometry={eastPillarGeo} position={[+(hw + ht), hy, +(hd + ht)]} castShadow receiveShadow>
        <meshBasicMaterial color="white" />
      </mesh>
      <mesh geometry={westPillarGeo} position={[-(hw + ht), hy, +(hd + ht)]} castShadow receiveShadow>
        <meshBasicMaterial color="white" />
      </mesh>
    </group>
  );
}
