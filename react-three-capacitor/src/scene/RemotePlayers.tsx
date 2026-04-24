import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import type { RemotePlayerInfo } from '../store/gameStore'
import { getInterpolatedPos, consumeRemoteEvents } from '../network/positionBuffer'
import { CapsuleFallback } from './animation/CapsuleFallback'
import type { AnimationState } from '../game/World'
import { getClientWorld } from '../game/clientWorld'
import { HeartSprite } from './HeartSprite'

const CAPSULE_CENTER_Y = 0.0282 + 0.0806 / 2

// Both positions and events play back against a single client-side render-tick
// pointer (positionBuffer.renderTickFloat) that lags the latest received server
// tick by a fixed buffer. No wall clock is consulted.

function RemotePlayerMesh({ info }: { info: RemotePlayerInfo }) {
  const { id, color, initialAnimState, hasHealth } = info
  const groupRef = useRef<THREE.Group>(null)
  const animStateRef = useRef<AnimationState>(initialAnimState)
  const [animState, setAnimState] = useState<AnimationState>(initialAnimState)
  const hp = useGameStore((s) => (s.playerHp[id] ?? 2)) as 0 | 1 | 2

  useFrame((state) => {
    const g = groupRef.current
    if (!g) return

    const pos = getInterpolatedPos(id)
    if (pos !== null) {
      g.position.set(pos.x, CAPSULE_CENTER_Y, pos.z)
      const cp = state.camera.position
      g.renderOrder = 1000 - Math.hypot(cp.x - pos.x, cp.y - CAPSULE_CENTER_Y, cp.z - pos.z)
      // Hide remote players who are inside a room not visible from the local player's room.
      // Players in corridors (not inside any room floor) are always shown.
      const { currentRoomId } = useGameStore.getState()
      const world = getClientWorld()
      let visible = true
      if (world) {
        const visibleRooms = new Set([currentRoomId, ...world.getAdjacentRoomIds(currentRoomId)])
        for (const view of world.getAllRooms()) {
          if (visibleRooms.has(view.scopedId)) continue
          const hw = view.room.floorWidth / 2
          const hd = view.room.floorDepth / 2
          if (Math.abs(pos.x - view.worldPos.x) <= hw && Math.abs(pos.z - view.worldPos.z) <= hd) {
            visible = false
            break
          }
        }
      }
      g.visible = visible
    } else {
      g.visible = false
    }

    const events = consumeRemoteEvents(id)
    for (const event of events) {
      if (event.type === 'update_animation_state' && event.animState !== animStateRef.current) {
        animStateRef.current = event.animState
        setAnimState(event.animState)
      } else if (event.type === 'damage') {
        useGameStore.getState().applyDamage(event.targetId, event.newHp)
      }
    }
  })

  return (
    <group ref={groupRef} visible={false}>
      <CapsuleFallback animationState={animState} color={color} />
      {hasHealth && <HeartSprite hp={hp} />}
    </group>
  )
}

export function RemotePlayers() {
  const remotePlayers = useGameStore((s) => s.remotePlayers)
  return (
    <>
      {Object.values(remotePlayers).map((info) => (
        <RemotePlayerMesh key={info.id} info={info} />
      ))}
    </>
  )
}
