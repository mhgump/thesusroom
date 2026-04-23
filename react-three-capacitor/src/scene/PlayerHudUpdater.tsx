import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getInterpolatedPos } from '../network/positionBuffer'
import { useGameStore } from '../store/gameStore'
import { hudRegistry } from './hudRegistry'
import { CAMERA_ANGLE } from '../game/constants'

const DELAY_MS = 250
const HEART_WORLD_SIZE = 0.0282
const BASE_HEART_PX = 20

const _v = new THREE.Vector3()

function applyHud(
  div: HTMLDivElement,
  x: number,
  z: number,
  camera: THREE.OrthographicCamera,
  width: number,
  height: number,
  scale: number,
) {
  _v.set(x, 0, z).project(camera)
  const sx = (_v.x * 0.5 + 0.5) * width
  const sy = (-_v.y * 0.5 + 0.5) * height
  div.style.transform = `translate(${sx}px,${sy}px) translate(-50%,-50%) scale(${scale})`
  if (div.style.display === 'none') div.style.display = ''
}

// Local player heart is updated directly in Player.useFrame (priority 0) so it always
// uses the freshly-predicted position in the same callback that moves the capsule.
// Remote players use time-based interpolation so priority -1 (runs first among useFrames
// but reads from the continuous interpolation buffer) is fine for them.
export function PlayerHudUpdater() {
  useFrame(({ camera, size }) => {
    if (!(camera instanceof THREE.OrthographicCamera)) return

    camera.updateMatrixWorld()

    const scale = (HEART_WORLD_SIZE * size.height / Math.cos(CAMERA_ANGLE)) / BASE_HEART_PX
    const store = useGameStore.getState()

    for (const id of Object.keys(store.remotePlayers)) {
      const div = hudRegistry.get(id)
      if (!div) continue
      const pos = getInterpolatedPos(id, DELAY_MS)
      if (pos === null) continue
      applyHud(div, pos.x, pos.z, camera, size.width, size.height, scale)
    }
  }, -1)

  return null
}
