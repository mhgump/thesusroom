import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Ground } from './Ground';
import { BgPlane, RoomOutsideTextures } from './Boundary';
import { Player } from './Player';
import { RemotePlayers } from './RemotePlayers';
import { TapToMoveLayer } from './TapToMoveLayer';
import { VoteRegions } from './VoteRegions';
import { GeometryLayer } from './GeometryLayer';
import { ButtonLayer } from './ButtonLayer';
import { useClientWorld } from '../game/clientWorld';
import { localPlayerPos } from '../game/localPlayerPos';
import { useGameStore } from '../store/gameStore';
import { advanceRenderTick } from '../network/positionBuffer';
import { clampToShapes } from '../game/CameraConstraint';
import type { Vec2 } from '../game/CameraConstraint';
import {
  CAMERA_ANGLE,
  CAMERA_DIST,
} from '../game/constants';

// Exponential smoothing time constants (seconds) for camera follow per axis.
// A lower value tracks faster; at 60 fps, 0.1 s ≈ 15 % movement per frame.
const DAMPING_X = 0.1
const DAMPING_Z = 0.1

export function GameScene() {
  const { camera, size, set } = useThree();
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const roomVisibility = useGameStore((s) => s.roomVisibility);
  const playerRoomVisibilityOverride = useGameStore((s) => s.playerRoomVisibilityOverride);
  const camTargetRef = useRef<Vec2 | null>(null);
  const world = useClientWorld();

  useEffect(() => {
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
    ortho.position.set(0, CAMERA_DIST * Math.cos(CAMERA_ANGLE), CAMERA_DIST * Math.sin(CAMERA_ANGLE));
    ortho.up.set(0, 1, 0);
    ortho.lookAt(0, 0, 0);
    set({ camera: ortho });
  }, [set]);

  useEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    // halfH gives 1 world unit of ground-plane distance on screen height: halfH = cos(θ)/2.
    // On portrait phones the natural halfW = halfH * aspect becomes too narrow, causing the
    // room to extend off-screen. We require at least 1 ground-plane unit in both axes, so
    // halfH = max(cos(θ)/2, 1/(2*aspect)) — the portrait branch zooms out to fit horizontally.
    const aspect = size.width / size.height;
    const halfH = Math.max(Math.cos(CAMERA_ANGLE) / 2, 1 / (2 * aspect));
    const halfW = halfH * aspect;
    camera.left = -halfW; camera.right = halfW;
    camera.top = halfH;   camera.bottom = -halfH;
    camera.updateProjectionMatrix();
  }, [camera, size]);

  // priority -3: advance the global remote-render-tick before any consumer
  // (Player, RemotePlayers — both at default priority 0) reads it this frame.
  useFrame((_state, delta) => {
    advanceRenderTick(delta);
  }, -3);

  // priority -2: runs before Player (0) so Player's useFrame sees the freshly-positioned camera.
  useFrame((state, delta) => {
    const cam = state.camera;
    if (!(cam instanceof THREE.OrthographicCamera)) return;
    if (!world) return;
    const { x: tx, z: tz } = clampToShapes(world.getCameraShapes(), localPlayerPos.x, localPlayerPos.z);

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

  const isRoomVisible = (scopedId: string) => {
    const override = playerRoomVisibilityOverride[scopedId]
    if (override !== undefined) return override
    // Overlapping rooms are hidden by default unless the player is inside the
    // room or an explicit server-side toggle says otherwise. Non-overlapping
    // rooms follow the map's default adjacency rendering.
    if (world?.isRoomOverlapping(scopedId) && scopedId !== currentRoomId) return false
    return roomVisibility[scopedId] !== false
  }
  const adjacent = world?.getAdjacentRoomIds(currentRoomId) ?? []
  const visibleIds = new Set(
    [currentRoomId, ...adjacent].filter(isRoomVisible)
  );
  const allRooms = world?.getAllRooms() ?? []
  const roomsToRender = allRooms.filter(r => visibleIds.has(r.scopedId))

  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[0.48, 0.97, 0.64]} intensity={0.75} castShadow />
      <BgPlane />
      {roomsToRender.map(view => (
        <group key={view.scopedId} position={[view.worldPos.x, 0, view.worldPos.z]}>
          <Ground room={view.room} />
          <RoomOutsideTextures room={view.room} />
        </group>
      ))}
      <GeometryLayer />
      <ButtonLayer />
      <VoteRegions visibleIds={visibleIds} />
      <Player />
      <RemotePlayers />
      <TapToMoveLayer />
    </>
  );
}
