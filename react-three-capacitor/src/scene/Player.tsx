import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import { World } from '../game/World'
import type { AnimationState } from '../game/World'
import { CapsuleFallback } from './animation/CapsuleFallback'
import { useWsSend } from '../network/useWebSocket'
import { consumeMoveAck } from '../network/positionBuffer'
import { localPlayerPos } from '../game/localPlayerPos'
import { DEFAULT_WALKABLE, getDefaultRoomAtPosition } from '../game/DefaultWorld'
import { hudRegistry } from './hudRegistry'
import { VIEWPORT_W } from '../game/constants'

const HEART_WORLD_SIZE = 0.35
const BASE_HEART_PX = 20
const _hv = new THREE.Vector3()

const CAPSULE_RADIUS = 0.35
const CAPSULE_LENGTH = 1.0
const CAPSULE_CENTER_Y = CAPSULE_RADIUS + CAPSULE_LENGTH / 2

const CORRECTION_THRESHOLD = 0.02
const INPUT_HISTORY_MAX = 180 // ~3 s at 60 fps

interface InputRecord { seq: number; jx: number; jz: number; dt: number }

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

  useFrame((state, delta) => {
    const store = useGameStore.getState()
    const playerId = store.playerId
    if (!playerId || !groupRef.current) return

    if (initializedForRef.current !== playerId) {
      const w = new World(DEFAULT_WALKABLE, ['touched'])
      w.addPlayer(playerId, store.initialPosition.x, store.initialPosition.z)
      worldRef.current = w
      initializedForRef.current = playerId
      seqRef.current = 0
      inputHistory.current = []
      animStateRef.current = 'IDLE'
    }
    const world = worldRef.current!

    // ── 1. Apply server correction ───────────────────────────────────────────
    const ack = consumeMoveAck()
    if (ack) {
      world.setPlayerPosition(playerId, ack.x, ack.z)
      for (const h of inputHistory.current) {
        if (h.seq > ack.seq) world.processMove(playerId, h.jx, h.jz, h.dt)
      }

      const wp = world.getPlayer(playerId)!
      if (wp.animState !== animStateRef.current) {
        animStateRef.current = wp.animState
        setAnimState(wp.animState)
      }

      const dx = wp.x - groupRef.current.position.x
      const dz = wp.z - groupRef.current.position.z
      if (Math.hypot(dx, dz) > CORRECTION_THRESHOLD) {
        groupRef.current.position.x = wp.x
        groupRef.current.position.z = wp.z
      }

      for (const event of ack.events) {
        if (event.type === 'touched') store.addNotification('Touched!')
        else if (event.type === 'damage') store.applyDamage(event.targetId, event.newHp)
      }
    }

    // ── 2. Predict this frame ────────────────────────────────────────────────
    if ((store.playerHp[playerId] ?? 2) === 0) {
      const player = world.getPlayer(playerId)!
      groupRef.current.position.x = player.x
      groupRef.current.position.z = player.z
      return
    }

    const { x: jx, y: jz } = store.joystickInput
    const events = world.processMove(playerId, jx, jz, delta)
    for (const event of events) {
      if (event.type === 'update_animation_state' && event.animState !== animStateRef.current) {
        animStateRef.current = event.animState
        setAnimState(event.animState)
      }
    }

    // ── 3. Send to server ────────────────────────────────────────────────────
    const seq = seqRef.current++
    inputHistory.current.push({ seq, jx, jz, dt: delta })
    if (inputHistory.current.length > INPUT_HISTORY_MAX) inputHistory.current.shift()
    sendMove(seq, jx, jz, delta)

    // ── 4. Update visuals + room tracking ───────────────────────────────────
    const player = world.getPlayer(playerId)!
    groupRef.current.position.x = player.x
    groupRef.current.position.z = player.z
    localPlayerPos.x = player.x
    localPlayerPos.z = player.z

    // Heart overlay: project this frame's position through the camera GameScene just moved.
    // camera.updateMatrixWorld() is needed because Three.js only syncs matrixWorldInverse
    // during gl.render(); without it the projection uses last frame's matrix.
    const heartDiv = hudRegistry.get('__local__')
    if (heartDiv) {
      const { camera, size } = state
      if (camera instanceof THREE.OrthographicCamera) {
        camera.updateMatrixWorld()
        _hv.set(player.x, 0, player.z).project(camera)
        const sx = (_hv.x * 0.5 + 0.5) * size.width
        const sy = (-_hv.y * 0.5 + 0.5) * size.height
        const scale = (HEART_WORLD_SIZE * (size.width / VIEWPORT_W)) / BASE_HEART_PX
        heartDiv.style.transform = `translate(${sx}px,${sy}px) translate(-50%,-50%) scale(${scale})`
        if (heartDiv.style.display === 'none') heartDiv.style.display = ''
      }
    }

    const newRoomId = getDefaultRoomAtPosition(player.x, player.z)
    if (newRoomId !== localPlayerPos.roomId) {
      localPlayerPos.roomId = newRoomId
      store.setCurrentRoomId(newRoomId)
    }
  })

  return (
    <group ref={groupRef} position={[0, CAPSULE_CENTER_Y, 0]}>
      <CapsuleFallback animationState={animState} color={localColor} />
    </group>
  )
}
