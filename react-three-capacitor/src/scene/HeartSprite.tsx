import * as THREE from 'three'

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
// Capsule top in world: CAPSULE_RADIUS + CAPSULE_LENGTH/2 + CAPSULE_CENTER_Y = 0.137.
// Placing the anchor above the top guarantees the sprite's (uniform) depth is
// closer to the camera than every fragment of the owning capsule, so the heart
// is never occluded by the player it belongs to. Other capsules can still
// depth-test closer than the heart and occlude it.
const HEART_Y = 0.15
// Local offset for a parent group whose origin is at CAPSULE_CENTER_Y.
const HEART_LOCAL_Y = HEART_Y - (0.0282 + 0.0806 / 2)

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
      position={[0, HEART_LOCAL_Y, 0]}
      scale={[HEART_WORLD_SIZE, HEART_WORLD_SIZE, 1]}
    >
      <spriteMaterial map={tex} transparent depthWrite={false} />
    </sprite>
  )
}
