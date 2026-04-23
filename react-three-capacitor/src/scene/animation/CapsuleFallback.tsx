import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { AnimationHandlerProps } from './types';

const CAPSULE_RADIUS = 0.0282;
const CAPSULE_LENGTH = 0.0806;

const COLOR_BLINK_A = new THREE.Color(0xffffff);
const COLOR_BLINK_B = new THREE.Color(0x222222);
const BLINK_HZ = 8;

export function CapsuleFallback({ animationState, color = '#cccccc' }: AnimationHandlerProps) {
  const matRef = useRef<THREE.MeshLambertMaterial>(null);
  const elapsed = useRef(0);
  // Lazy-init so we only allocate one Color object even across re-renders
  const idleColor = useRef(new THREE.Color(color));

  useFrame((_, delta) => {
    if (!matRef.current) return;
    // Keep idle color in sync if the assigned color prop changes
    idleColor.current.set(color);
    if (animationState === 'IDLE') {
      matRef.current.color.copy(idleColor.current);
      elapsed.current = 0;
      return;
    }
    elapsed.current += delta;
    const on = Math.floor(elapsed.current * BLINK_HZ) % 2 === 0;
    matRef.current.color.copy(on ? COLOR_BLINK_A : COLOR_BLINK_B);
  });

  return (
    <>
      <mesh castShadow>
        <capsuleGeometry args={[CAPSULE_RADIUS, CAPSULE_LENGTH, 8, 16]} />
        <meshLambertMaterial ref={matRef} color={color} />
      </mesh>
      <mesh position={[0, CAPSULE_LENGTH / 2 + CAPSULE_RADIUS - 0.004, 0]}>
        <sphereGeometry args={[0.008, 8, 8]} />
        <meshBasicMaterial color="#00ccff" />
      </mesh>
    </>
  );
}
