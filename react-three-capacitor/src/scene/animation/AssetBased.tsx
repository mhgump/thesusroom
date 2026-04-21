import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { AnimationHandlerProps } from './types';

const SPRITE_WIDTH = 1.0;
const SPRITE_HEIGHT = 2.0;

interface AssetBasedProps extends AnimationHandlerProps {
  idleTexture: THREE.Texture;
  walkingTexture: THREE.Texture;
}

export function AssetBased({ animationState, idleTexture, walkingTexture }: AssetBasedProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const { camera } = useThree();

  useFrame(() => {
    if (meshRef.current) meshRef.current.lookAt(camera.position);
    if (matRef.current) {
      matRef.current.map = animationState === 'WALKING' ? walkingTexture : idleTexture;
      matRef.current.needsUpdate = true;
    }
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[SPRITE_WIDTH, SPRITE_HEIGHT]} />
      <meshBasicMaterial
        ref={matRef}
        map={idleTexture}
        transparent
        alphaTest={0.1}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
