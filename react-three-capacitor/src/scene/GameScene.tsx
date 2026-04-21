import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Ground } from './Ground';
import { Walls } from './Walls';
import { Player } from './Player';
import { RemotePlayers } from './RemotePlayers';
import { FRUSTUM_TOP, FRUSTUM_BOTTOM, FRUSTUM_H, FRUSTUM_W, CAMERA_ANGLE, WALL_HEIGHT, SCENE_MIN_BORDER } from '../game/constants';

const CAMERA_DIST = 60;

export function GameScene() {
  const { camera, size, set } = useThree();

  useEffect(() => {
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
    // target at wall-top height centres the symmetric frustum on the wall-top quad
    const target = new THREE.Vector3(0, WALL_HEIGHT, 0);
    ortho.position.set(
      0,
      target.y + CAMERA_DIST * Math.cos(CAMERA_ANGLE),
      target.z + CAMERA_DIST * Math.sin(CAMERA_ANGLE),
    );
    ortho.up.set(0, 1, 0);
    ortho.lookAt(target);
    set({ camera: ortho });
  }, [set]);

  useEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    const screenAspect = size.width / size.height;
    const roomAspect = FRUSTUM_W / FRUSTUM_H;
    const halfW = FRUSTUM_W / 2;
    const halfH = FRUSTUM_H / 2;

    if (screenAspect <= roomAspect) {
      // Narrow: zoom so top/bottom room edges lock to screen edges; left/right are cropped.
      // Falls back to letterbox (full room width shown, outside content above/below) when
      // the cropped half-width would drop below SCENE_MIN_BORDER.
      const zoomedHalfW = halfH * screenAspect;
      if (zoomedHalfW >= SCENE_MIN_BORDER) {
        camera.top = FRUSTUM_TOP;
        camera.bottom = -FRUSTUM_BOTTOM;
        camera.left = -zoomedHalfW;
        camera.right = zoomedHalfW;
      } else {
        const vScale = halfW / (halfH * screenAspect);
        camera.top = FRUSTUM_TOP * vScale;
        camera.bottom = -FRUSTUM_BOTTOM * vScale;
        camera.left = -halfW;
        camera.right = halfW;
      }
    } else {
      // Wide: zoom so left/right room edges lock to screen edges; top/bottom are cropped.
      // Falls back to pillarbox (full room height shown, outside content left/right) when
      // the cropped half-height would drop below SCENE_MIN_BORDER.
      const hScale = roomAspect / screenAspect;
      const zoomedHalfH = halfH * hScale;
      if (zoomedHalfH >= SCENE_MIN_BORDER) {
        camera.left = -halfW;
        camera.right = halfW;
        camera.top = FRUSTUM_TOP * hScale;
        camera.bottom = -FRUSTUM_BOTTOM * hScale;
      } else {
        camera.top = FRUSTUM_TOP;
        camera.bottom = -FRUSTUM_BOTTOM;
        camera.left = -halfH * screenAspect;
        camera.right = halfH * screenAspect;
      }
    }
    camera.updateProjectionMatrix();
  }, [camera, size]);

  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[6, 12, 8]} intensity={0.75} castShadow />
      <Ground />
      <Walls />
      <Player />
      <RemotePlayers />
    </>
  );
}
