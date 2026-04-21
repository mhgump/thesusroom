import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import type { RemotePlayerInfo } from '../store/gameStore'
import { getInterpolatedPos, consumeRemoteEvents } from '../network/positionBuffer'
import { CapsuleFallback } from './animation/CapsuleFallback'
import type { AnimationState } from '../game/World'

const CAPSULE_CENTER_Y = 0.35 + 1.0 / 2 // CAPSULE_RADIUS + CAPSULE_LENGTH / 2

// Positions are interpolated at (estimatedServerTime − DELAY_MS).
// Events are consumed once max(receiptTime, serverStartTime + DELAY_MS) is reached,
// keeping both streams temporally aligned to server time.
const DELAY_MS = 250

interface RemotePlayerMeshProps {
  info: RemotePlayerInfo
}

function RemotePlayerMesh({ info }: RemotePlayerMeshProps) {
  const { id, color, initialAnimState } = info
  const groupRef = useRef<THREE.Group>(null)
  const animStateRef = useRef<AnimationState>(initialAnimState)
  const [animState, setAnimState] = useState<AnimationState>(initialAnimState)

  useFrame(() => {
    const g = groupRef.current
    if (!g) return

    // Update visual position via interpolated snapshot buffer
    const pos = getInterpolatedPos(id, DELAY_MS)
    if (pos !== null) {
      g.visible = true
      g.position.set(pos.x, CAPSULE_CENTER_Y, pos.z)
    }

    // Consume world events whose play window has been reached
    const events = consumeRemoteEvents(id, DELAY_MS)
    for (const { event } of events) {
      if (event.type === 'update_animation_state' && event.animState !== animStateRef.current) {
        animStateRef.current = event.animState
        setAnimState(event.animState)
      } else if (event.type === 'touched') {
        useGameStore.getState().addNotification('Touched!')
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
