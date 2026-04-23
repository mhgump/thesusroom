import * as THREE from 'three'
import { CAMERA_ANGLE } from '../game/constants'

const HEART_PATH_D =
  'M8 14C3 9.5 0 7 0 4.5 0 2 1.8 1 4 1c1.5 0 3 1 4 2.5C9 2 10.5 1 12 1c2.2 0 4 1 4 3.5 0 2.5-3 5-8 9.5z'

function makeHeartTexture(half: boolean): THREE.CanvasTexture {
  const SIZE = 128
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  ctx.scale(SIZE / 16, SIZE / 16)

  const path = new Path2D(HEART_PATH_D)
  ctx.lineWidth = 1
  ctx.lineJoin = 'round'

  if (half) {
    ctx.strokeStyle = '#e74c3c'
    ctx.stroke(path)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, 8, 16)
    ctx.clip()
    ctx.fillStyle = '#e74c3c'
    ctx.fill(path)
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'
    ctx.stroke(path)
    ctx.restore()
  } else {
    ctx.fillStyle = '#e74c3c'
    ctx.fill(path)
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'
    ctx.stroke(path)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

let fullTex: THREE.CanvasTexture | null = null
let halfTex: THREE.CanvasTexture | null = null

const HEART_WORLD_SIZE = 0.0282
const CAPSULE_RADIUS = 0.0282
const CAPSULE_LENGTH = 0.0806
const CAPSULE_CENTER_Y = CAPSULE_RADIUS + CAPSULE_LENGTH / 2
const CAPSULE_TOP_Y = CAPSULE_LENGTH / 2 + CAPSULE_RADIUS + CAPSULE_CENTER_Y
// HEART_Y and HEART_Z only exist to shape where the sprite projects on screen
// (directly below the feet). Player-to-player layering is driven by the parent
// group's renderOrder — see Player.tsx / RemotePlayers.tsx.
const HEART_MARGIN = 0.008
const HEART_Y = CAPSULE_TOP_Y + HEART_MARGIN
const HEART_Z =
  HEART_WORLD_SIZE / (2 * Math.cos(CAMERA_ANGLE)) + HEART_Y * Math.tan(CAMERA_ANGLE)
const HEART_LOCAL_Y = HEART_Y - CAPSULE_CENTER_Y

interface Props {
  hp: 0 | 1 | 2
}

export function HeartSprite({ hp }: Props) {
  if (hp === 0) return null
  if (!fullTex) fullTex = makeHeartTexture(false)
  if (!halfTex) halfTex = makeHeartTexture(true)
  const tex = hp === 2 ? fullTex : halfTex
  return (
    <sprite
      position={[0, HEART_LOCAL_Y, HEART_Z]}
      scale={[HEART_WORLD_SIZE, HEART_WORLD_SIZE, 1]}
      renderOrder={1}
    >
      <spriteMaterial
        map={tex}
        transparent={false}
        alphaTest={0.5}
        depthTest={false}
        depthWrite={false}
      />
    </sprite>
  )
}
