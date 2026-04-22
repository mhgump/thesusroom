import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Ground } from './Ground';
import { Barrier } from './Walls';
import { BgPlane, RoomOutsideTextures } from './Boundary';
import { Player } from './Player';
import { RemotePlayers } from './RemotePlayers';
import { PlayerHudUpdater } from './PlayerHudUpdater';
import { VoteRegions } from './VoteRegions';
import { GeometryLayer } from './GeometryLayer';
import { ButtonLayer } from './ButtonLayer';
import { CURRENT_MAP } from '../../../content/client/maps';
import { getRoomWallOpenings } from '../game/WorldSpec';
import { localPlayerPos } from '../game/localPlayerPos';
import { useGameStore } from '../store/gameStore';
import { clampToShapes } from '../game/CameraConstraint';
import type { Vec2 } from '../game/CameraConstraint';
import {
  CAMERA_ANGLE,
  CAMERA_DIST,
  VIEWPORT_W,
} from '../game/constants';

// Exponential smoothing time constants (seconds) for camera follow per axis.
// A lower value tracks faster; at 60 fps, 0.1 s ≈ 15 % movement per frame.
const DAMPING_X = 0.1
const DAMPING_Z = 0.1

export function GameScene() {
  const { camera, size, set } = useThree();
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const camTargetRef = useRef<Vec2 | null>(null);

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
  useFrame((state, delta) => {
    const cam = state.camera;
    if (!(cam instanceof THREE.OrthographicCamera)) return;

    const { x: tx, z: tz } = clampToShapes(CURRENT_MAP.cameraShapes, localPlayerPos.x, localPlayerPos.z);

    // Initialise target on first frame to avoid a visible jump from origin.
    if (!camTargetRef.current) {
      camTargetRef.current = { x: tx, z: tz };
    }

    // Exponential approach: alpha approaches 1 as delta grows relative to the time constant.
    const ax = 1 - Math.exp(-delta / DAMPING_X);
    const az = 1 - Math.exp(-delta / DAMPING_Z);
    camTargetRef.current.x += (tx - camTargetRef.current.x) * ax;
    camTargetRef.current.z += (tz - camTargetRef.current.z) * az;

    cam.position.set(
      camTargetRef.current.x,
      CAMERA_DIST * Math.cos(CAMERA_ANGLE),
      camTargetRef.current.z + CAMERA_DIST * Math.sin(CAMERA_ANGLE),
    );
  }, -2);

  const visibleIds = new Set([currentRoomId, ...(CURRENT_MAP.worldSpec.visibility[currentRoomId] ?? [])]);
  const roomsToRender = CURRENT_MAP.worldSpec.rooms.filter(r => visibleIds.has(r.id));

  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[6, 12, 8]} intensity={0.75} castShadow />
      <BgPlane />
      {roomsToRender.map(room => {
        const pos = CURRENT_MAP.roomPositions.get(room.id)!;
        const openings = getRoomWallOpenings(CURRENT_MAP.worldSpec, room.id);
        return (
          <group key={room.id} position={[pos.x, 0, pos.z]}>
            <Ground room={room} />
            <Barrier room={room} openings={openings} />
            <RoomOutsideTextures room={room} />
          </group>
        );
      })}
      <GeometryLayer />
      <ButtonLayer />
      <VoteRegions />
      <Player />
      <RemotePlayers />
      <PlayerHudUpdater />
    </>
  );
}
