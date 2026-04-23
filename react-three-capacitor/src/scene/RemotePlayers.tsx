import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import type { RemotePlayerInfo } from '../store/gameStore'
import { getInterpolatedPos, consumeRemoteEvents, getAdaptiveDelayMs } from '../network/positionBuffer'
import { CapsuleFallback } from './animation/CapsuleFallback'
import type { AnimationState } from '../game/World'
import { CURRENT_MAP } from '../../../content/client/maps'

const CAPSULE_CENTER_Y = 0.0282 + 0.0806 / 2

// Positions are interpolated at (estimatedServerTime − adaptiveDelayMs).
// Events are consumed once max(receiptTime, serverStartTime + adaptiveDelayMs) is reached,
// keeping both streams temporally aligned to server time.

function RemotePlayerMesh({ info }: { info: RemotePlayerInfo }) {
  const { id, color, initialAnimState } = info
  const groupRef = useRef<THREE.Group>(null)
  const animStateRef = useRef<AnimationState>(initialAnimState)
  const [animState, setAnimState] = useState<AnimationState>(initialAnimState)

  useFrame(() => {
    const g = groupRef.current
    if (!g) return

    const pos = getInterpolatedPos(id, getAdaptiveDelayMs())
    if (pos !== null) {
      g.position.set(pos.x, CAPSULE_CENTER_Y, pos.z)
      // Hide remote players who are inside a room not visible from the local player's room.
      // Players in corridors (not inside any room floor) are always shown.
      const { currentRoomId } = useGameStore.getState()
      const visibleRooms = new Set([currentRoomId, ...(CURRENT_MAP.worldSpec.visibility[currentRoomId] ?? [])])
      let visible = true
      for (const room of CURRENT_MAP.worldSpec.rooms) {
        if (visibleRooms.has(room.id)) continue
        const roomPos = CURRENT_MAP.roomPositions.get(room.id)
        if (!roomPos) continue
        const hw = room.floorWidth / 2
        const hd = room.floorDepth / 2
        if (Math.abs(pos.x - roomPos.x) <= hw && Math.abs(pos.z - roomPos.z) <= hd) {
          visible = false
          break
        }
      }
      g.visible = visible
    } else {
      g.visible = false
    }

    const events = consumeRemoteEvents(id, getAdaptiveDelayMs())
    for (const { event } of events) {
      if (event.type === 'update_animation_state' && event.animState !== animStateRef.current) {
        animStateRef.current = event.animState
        setAnimState(event.animState)
      } else if (event.type === 'touched') {
        useGameStore.getState().addNotification('Touched!')
      } else if (event.type === 'damage') {
        useGameStore.getState().applyDamage(event.targetId, event.newHp)
      }
    }
  })

  return (
    <group ref={groupRef} visible={false}>
      <CapsuleFallback animationState={animState} color={color} />
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
