import { useMemo } from 'react';
import * as THREE from 'three';
import type { RoomSpec, OutsideTextureSpec } from '../game/RoomSpec';
import { Textures } from '../game/textures';

// Large black-with-stripes plane covering everything outside all rooms.
// Rendered once at the GameScene level, below all floor planes.
const BG_HALF = 16
const BG_TILE = 0.5

export function BgPlane() {
  const texture = useMemo(() => {
    const t = Textures.fallbackOutsideWall()
    t.repeat.set(BG_HALF * 2 / BG_TILE, BG_HALF * 2 / BG_TILE)
    return t
  }, [])

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
      <planeGeometry args={[BG_HALF * 2, BG_HALF * 2]} />
      <meshBasicMaterial map={texture} />
    </mesh>
  )
}

// Renders outside textures for a single room (placed in the room's local group).
function OutsidePlane({ room, spec }: { room: RoomSpec; spec: OutsideTextureSpec }) {
  const { floorWidth: fw, floorDepth: fd } = room
  const hw = fw / 2, hd = fd / 2

  const texture = useMemo(() => {
    if (spec.imageUrl) {
      const t = new THREE.TextureLoader().load(spec.imageUrl)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      return t
    }
    const canvas = document.createElement('canvas')
    canvas.width = 128; canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = spec.color ?? 'black'
    ctx.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(canvas)
  }, [spec.imageUrl, spec.color])

  // Convert wall-relative spec to room-local position
  let px: number, pz: number, pw: number, pd: number
  const { positionAlong: along, parallelWidth: par, outwardDepth: out } = spec
  switch (spec.wall) {
    case 'north':
      px = (along - 0.5) * fw; pz = -(hd + out / 2); pw = par; pd = out; break
    case 'south':
      px = (along - 0.5) * fw; pz = +(hd + out / 2); pw = par; pd = out; break
    case 'east':
      px = +(hw + out / 2); pz = (along - 0.5) * fd; pw = out; pd = par; break
    case 'west':
      px = -(hw + out / 2); pz = (along - 0.5) * fd; pw = out; pd = par; break
  }

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[px, 0.005, pz]}>
      <planeGeometry args={[pw, pd]} />
      <meshBasicMaterial map={texture} />
    </mesh>
  )
}

// Renders any OutsideTextureSpec entries for a room (placed inside the room's group).
export function RoomOutsideTextures({ room }: { room: RoomSpec }) {
  if (!room.outsideTextures?.length) return null
  return (
    <>
      {room.outsideTextures.map((spec, i) => (
        <OutsidePlane key={i} room={room} spec={spec} />
      ))}
    </>
  )
}
