import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import { World } from '../game/World'
import type { AnimationState } from '../game/World'
import { CapsuleFallback } from './animation/CapsuleFallback'
import { useWsSend } from '../network/useWebSocket'
import { consumeMoveAck } from '../network/positionBuffer'

const CAPSULE_RADIUS = 0.35
const CAPSULE_LENGTH = 1.0
const CAPSULE_CENTER_Y = CAPSULE_RADIUS + CAPSULE_LENGTH / 2

const CORRECTION_THRESHOLD = 0.02
const INPUT_HISTORY_MAX = 180 // ~3 s at 60 fps

interface InputRecord {
  seq: number
  jx: number
  jz: number
  dt: number
}

export function Player() {
  const groupRef = useRef<THREE.Group>(null)
  const worldRef = useRef<World | null>(null)
  const initializedForRef = useRef<string | null>(null)
  const seqRef = useRef(0)
  const inputHistory = useRef<InputRecord[]>([])
  const animStateRef = useRef<AnimationState>('IDLE')

  const localColor = useGameStore((s) => s.localColor)
  const { sendMove } = useWsSend()
  const [animState, setAnimState] = useState<AnimationState>('IDLE')

  useFrame((_, delta) => {
    const store = useGameStore.getState()
    const playerId = store.playerId
    if (!playerId || !groupRef.current) return

    // Lazy World init — once per playerId, using server-authoritative spawn position
    if (initializedForRef.current !== playerId) {
      const w = new World(['touched']) // clients never emit 'touched' locally
      w.addPlayer(playerId, store.initialPosition.x, store.initialPosition.z)
      worldRef.current = w
      initializedForRef.current = playerId
      seqRef.current = 0
      inputHistory.current = []
      animStateRef.current = 'IDLE'
    }
    const world = worldRef.current!

    // ── 1. Apply server correction (move_ack, processed immediately) ───────
    const ack = consumeMoveAck()
    if (ack) {
      // Reset to server-authoritative position at ack.seq, then replay all
      // inputs that arrived after it to get the expected current position.
      world.setPlayerPosition(playerId, ack.x, ack.z)
      for (const h of inputHistory.current) {
        if (h.seq > ack.seq) world.processMove(playerId, h.jx, h.jz, h.dt)
      }

      // Sync animation state with the replayed world state (no interpolation)
      const wp = world.getPlayer(playerId)!
      if (wp.animState !== animStateRef.current) {
        animStateRef.current = wp.animState
        setAnimState(wp.animState)
      }

      // Snap visual if the corrected prediction differs from the last frame
      const dx = wp.x - groupRef.current.position.x
      const dz = wp.z - groupRef.current.position.z
      if (Math.hypot(dx, dz) > CORRECTION_THRESHOLD) {
        groupRef.current.position.x = wp.x
        groupRef.current.position.z = wp.z
      }

      // Process server-only events (e.g. Touched) immediately — not buffered
      for (const event of ack.events) {
        if (event.type === 'touched') store.addNotification('Touched!')
      }
    }

    // ── 2. Predict this frame's movement through the shared World ───────────
    const { x: jx, y: jz } = store.joystickInput
    const events = world.processMove(playerId, jx, jz, delta)
    for (const event of events) {
      if (event.type === 'update_animation_state' && event.animState !== animStateRef.current) {
        animStateRef.current = event.animState
        setAnimState(event.animState)
      }
    }

    // ── 3. Send to server (seq matches history index) ────────────────────────
    const seq = seqRef.current++
    inputHistory.current.push({ seq, jx, jz, dt: delta })
    if (inputHistory.current.length > INPUT_HISTORY_MAX) inputHistory.current.shift()
    sendMove(seq, jx, jz, delta)

    // ── 4. Update visual to current world position (immediate, no lerp) ─────
    const player = world.getPlayer(playerId)!
    groupRef.current.position.x = player.x
    groupRef.current.position.z = player.z
  })

  return (
    <group ref={groupRef} position={[0, CAPSULE_CENTER_Y, 0]}>
      <CapsuleFallback animationState={animState} color={localColor} />
    </group>
  )
}
