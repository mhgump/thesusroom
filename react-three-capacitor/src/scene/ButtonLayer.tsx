import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import { localPlayerPos } from '../game/localPlayerPos'
import { playButtonPress } from '../sounds'
import type { ButtonSpec, ButtonState } from '../game/GameSpec'

const PRESS_LERP_SPEED = 14
const CAP_ABOVE_RING = 0.06   // cap top above ring top when idle
const CAP_BELOW_RING = 0.04   // cap top below ring top when pressed

function capTargetY(ringHeight: number, raisedHeight: number, isDown: boolean): number {
  const capHalf = raisedHeight / 2
  return isDown
    ? ringHeight - CAP_BELOW_RING - capHalf
    : ringHeight + CAP_ABOVE_RING - capHalf
}

function SingleButton({ spec }: { spec: ButtonSpec }) {
  const platformRef = useRef<THREE.Mesh>(null)
  const platformMatRef = useRef<THREE.MeshLambertMaterial>(null)
  const prevStateRef = useRef<ButtonState>('idle')
  const localPressRef = useRef(false)
  const ringHeight = (spec.raisedHeight * 2) / 3

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

    if (platformRef.current) {
      const localPressing = store.localButtonPressing[spec.id] ?? false
      const isDown = state === 'pressed' || state === 'cooldown' || localPressing
      const targetY = capTargetY(ringHeight, spec.raisedHeight, isDown)
      const curr = platformRef.current.position.y
      platformRef.current.position.y = curr + (targetY - curr) * Math.min(1, delta * PRESS_LERP_SPEED)
    }

    if (platformMatRef.current) {
      platformMatRef.current.color.set(state === 'disabled' ? '#555555' : spec.color)
    }
  })

  const initialDown = spec.initialState === 'pressed' || spec.initialState === 'cooldown'

  return (
    <group position={[spec.x, 0, spec.z]}>
      {/* Outer ring wall — open-ended cylinder, no top/bottom faces */}
      <mesh position={[0, ringHeight / 2, 0]}>
        <cylinderGeometry args={[spec.ringOuterRadius, spec.ringOuterRadius, ringHeight, 32, 1, true]} />
        <meshLambertMaterial color={spec.ringColor} />
      </mesh>
      {/* Top annular face — seals the ring top, inner edge flush with cap */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, ringHeight, 0]}>
        <ringGeometry args={[spec.platformRadius, spec.ringOuterRadius, 32]} />
        <meshLambertMaterial color={spec.ringColor} />
      </mesh>
      {/* Button cap — slides up through ring when idle, slightly below ring top when pressed */}
      <mesh ref={platformRef} position={[0, capTargetY(ringHeight, spec.raisedHeight, initialDown), 0]}>
        <cylinderGeometry args={[spec.platformRadius, spec.platformRadius, spec.raisedHeight, 32]} />
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
