import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import { localPlayerPos } from '../game/localPlayerPos'
import { playButtonPress } from '../sounds'
import type { ButtonSpec, ButtonState } from '../game/GameSpec'

const PRESS_LERP_SPEED = 14

function ringOpacity(state: ButtonState, occupancy: number): number {
  if (state === 'pressed') return 0.95
  if (state === 'cooldown') return 0.3
  if (state === 'disabled') return 0.15
  return occupancy > 0 ? 0.75 : 0.5
}

function SingleButton({ spec }: { spec: ButtonSpec }) {
  const platformRef = useRef<THREE.Mesh>(null)
  const platformMatRef = useRef<THREE.MeshLambertMaterial>(null)
  const ringMatRef = useRef<THREE.MeshBasicMaterial>(null)
  const prevStateRef = useRef<ButtonState>('idle')
  const localPressRef = useRef(false)

  const ringGeo = useMemo(
    () => new THREE.RingGeometry(spec.ringInnerRadius, spec.ringOuterRadius, 64),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec.ringInnerRadius, spec.ringOuterRadius],
  )

  useFrame((_, delta) => {
    const store = useGameStore.getState()
    const runtime = store.buttonStates[spec.id]
    if (!runtime) return
    const { state, occupancy } = runtime

    // Local player press detection — immediate tactile response.
    if (spec.enableClientPress) {
      const { x: px, z: pz } = localPlayerPos
      const wasLocal = localPressRef.current
      const isLocal = Math.hypot(px - spec.x, pz - spec.z) <= spec.triggerRadius
      if (isLocal && !wasLocal) {
        localPressRef.current = true
        store.setLocalButtonPressing(spec.id, true)
        playButtonPress()
      } else if (!isLocal && wasLocal) {
        localPressRef.current = false
        store.setLocalButtonPressing(spec.id, false)
      }
    }

    // Server-authoritative press: play sound only if this client didn't already press locally.
    if (state === 'pressed' && prevStateRef.current !== 'pressed' && !localPressRef.current) {
      playButtonPress()
    }
    prevStateRef.current = state

    // Animate platform Y toward idle/pressed target.
    if (platformRef.current) {
      const targetY = (state === 'pressed' || state === 'cooldown') ? 0.01 : spec.raisedHeight / 2
      const curr = platformRef.current.position.y
      platformRef.current.position.y = curr + (targetY - curr) * Math.min(1, delta * PRESS_LERP_SPEED)
    }

    // Update platform color for disabled state.
    if (platformMatRef.current) {
      platformMatRef.current.color.set(state === 'disabled' ? '#555555' : spec.color)
    }

    // Update ring opacity based on state + occupancy.
    if (ringMatRef.current) {
      ringMatRef.current.opacity = ringOpacity(state, occupancy)
    }
  })

  return (
    <group position={[spec.x, 0, spec.z]}>
      {/* Flat ring lying on the floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} geometry={ringGeo}>
        <meshBasicMaterial
          ref={ringMatRef}
          color={spec.ringColor}
          transparent
          opacity={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Raised platform — animates down when pressed */}
      <mesh ref={platformRef} position={[0, spec.raisedHeight / 2, 0]}>
        <cylinderGeometry args={[spec.platformRadius, spec.platformRadius * 1.15, spec.raisedHeight, 32]} />
        <meshLambertMaterial ref={platformMatRef} color={spec.color} />
      </mesh>
    </group>
  )
}

export function ButtonLayer() {
  const buttonSpecs = useGameStore((s) => s.buttonSpecs)
  return (
    <>
      {Object.values(buttonSpecs).map((spec) => (
        <SingleButton key={spec.id} spec={spec} />
      ))}
    </>
  )
}
