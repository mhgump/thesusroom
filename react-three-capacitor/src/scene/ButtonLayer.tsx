import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import { localPlayerPos } from '../game/localPlayerPos'
import { playButtonPress } from '../sounds'
import type { ButtonSpec, ButtonState } from '../game/GameSpec'

const PRESS_LERP_SPEED = 14

function SingleButton({ spec }: { spec: ButtonSpec }) {
  const pivotRef = useRef<THREE.Group>(null)
  const capMatRef = useRef<THREE.MeshLambertMaterial>(null)
  const prevStateRef = useRef<ButtonState>('idle')
  const localPressRef = useRef(false)

  const rimHeight = (spec.raisedHeight * 2) / 3
  // Scale at which inner cylinder top is flush with rim top
  const pressedScale = rimHeight / spec.raisedHeight

  useFrame((_, delta) => {
    const store = useGameStore.getState()
    const runtime = store.buttonStates[spec.id]
    if (!runtime) return
    const { state } = runtime

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

    if (pivotRef.current) {
      const localPressing = store.localButtonPressing[spec.id] ?? false
      const isDown = state === 'pressed' || state === 'cooldown' || localPressing
      const targetScale = isDown ? pressedScale : 1
      const curr = pivotRef.current.scale.y
      pivotRef.current.scale.y = curr + (targetScale - curr) * Math.min(1, delta * PRESS_LERP_SPEED)
    }

    if (capMatRef.current) {
      capMatRef.current.color.set(state === 'disabled' ? '#555555' : spec.color)
    }
  })

  const initialDown = spec.initialState === 'pressed' || spec.initialState === 'cooldown'
  const initialScale = initialDown ? pressedScale : 1

  return (
    <group position={[spec.x, 0, spec.z]}>
      {/* Outer rim wall — open-ended cylinder, bottom at y=0 */}
      <mesh position={[0, rimHeight / 2, 0]}>
        <cylinderGeometry args={[spec.ringOuterRadius, spec.ringOuterRadius, rimHeight, 32, 1, true]} />
        <meshLambertMaterial color={spec.ringColor} />
      </mesh>
      {/* Rim top annular face */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, rimHeight, 0]}>
        <ringGeometry args={[spec.platformRadius, spec.ringOuterRadius, 32]} />
        <meshLambertMaterial color={spec.ringColor} />
      </mesh>
      {/* Inner cylinder — pivot at y=0 so scaling keeps the bottom fixed on the ground */}
      <group ref={pivotRef} scale={[1, initialScale, 1]}>
        <mesh position={[0, spec.raisedHeight / 2, 0]}>
          <cylinderGeometry args={[spec.platformRadius, spec.platformRadius, spec.raisedHeight, 32]} />
          <meshLambertMaterial ref={capMatRef} color={spec.color} />
        </mesh>
      </group>
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
