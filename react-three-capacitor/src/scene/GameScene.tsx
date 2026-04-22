import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Ground } from './Ground';
import { Barrier } from './Walls';
import { BgPlane, RoomOutsideTextures } from './Boundary';
import { Player } from './Player';
import { RemotePlayers } from './RemotePlayers';
import { PlayerHudUpdater } from './PlayerHudUpdater';
import { DEFAULT_WORLD, DEFAULT_ROOM_POSITIONS } from '../game/DefaultWorld';
import { getRoomWallOpenings } from '../game/WorldSpec';
import { localPlayerPos } from '../game/localPlayerPos';
import { useGameStore } from '../store/gameStore';
import { buildCameraConstraintPoly, clampToPoly } from '../game/CameraConstraint';
import type { Vec2 } from '../game/CameraConstraint';
import {
  CAMERA_ANGLE,
  CAMERA_DIST,
  VIEWPORT_W,
} from '../game/constants';

export function GameScene() {
  const { camera, size, set } = useThree();
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const polyCache = useRef<{ poly: Vec2[]; halfW: number; halfGroundZ: number } | null>(null);

  useEffect(() => {
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
    ortho.position.set(0, CAMERA_DIST * Math.cos(CAMERA_ANGLE), CAMERA_DIST * Math.sin(CAMERA_ANGLE));
    ortho.up.set(0, 1, 0);
    ortho.lookAt(0, 0, 0);
    set({ camera: ortho });
  }, [set]);

  useEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    const halfW = VIEWPORT_W / 2;
    const halfH = halfW / (size.width / size.height);
    camera.left = -halfW; camera.right = halfW;
    camera.top = halfH;   camera.bottom = -halfH;
    camera.updateProjectionMatrix();
  }, [camera, size]);

  // priority -2: runs before PlayerHudUpdater (-1) and Player (0) so both can call
  // camera.updateMatrixWorld() against the freshly-positioned camera this frame.
  useFrame((state) => {
    const cam = state.camera;
    if (!(cam instanceof THREE.OrthographicCamera)) return;

    const halfW = cam.right;
    const halfH = cam.top;
    const halfGroundZ = halfH / Math.cos(CAMERA_ANGLE);

    const cache = polyCache.current;
    if (!cache || cache.halfW !== halfW || cache.halfGroundZ !== halfGroundZ) {
      polyCache.current = {
        poly: buildCameraConstraintPoly(DEFAULT_WORLD, DEFAULT_ROOM_POSITIONS, halfW, halfGroundZ),
        halfW,
        halfGroundZ,
      };
    }

    const { x: tx, z: tz } = clampToPoly(polyCache.current!.poly, localPlayerPos.x, localPlayerPos.z);
    cam.position.set(tx, CAMERA_DIST * Math.cos(CAMERA_ANGLE), tz + CAMERA_DIST * Math.sin(CAMERA_ANGLE));
  }, -2);

  const visibleIds = new Set([currentRoomId, ...(DEFAULT_WORLD.visibility[currentRoomId] ?? [])]);
  const roomsToRender = DEFAULT_WORLD.rooms.filter(r => visibleIds.has(r.id));

  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[6, 12, 8]} intensity={0.75} castShadow />
      <BgPlane />
      {roomsToRender.map(room => {
        const pos = DEFAULT_ROOM_POSITIONS.get(room.id)!;
        const openings = getRoomWallOpenings(DEFAULT_WORLD, room.id);
        return (
          <group key={room.id} position={[pos.x, 0, pos.z]}>
            <Ground room={room} />
            <Barrier room={room} openings={openings} />
            <RoomOutsideTextures room={room} />
          </group>
        );
      })}
      <Player />
      <RemotePlayers />
      <PlayerHudUpdater />
    </>
  );
}
