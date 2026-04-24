import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import { World, TICK_RATE_HZ } from '../game/World'
import type { AnimationState, MoveInput } from '../game/World'
import { CapsuleFallback } from './animation/CapsuleFallback'
import { useWsSend } from '../network/useWebSocket'
import { consumeMoveAcks, getInterpolatedPos } from '../network/positionBuffer'
import { localPlayerPos } from '../game/localPlayerPos'
import { getClientWorld } from '../game/clientWorld'
import { localWorld } from '../game/localWorld'
import { HeartSprite } from './HeartSprite'

const CAPSULE_RADIUS = 0.0282
const CAPSULE_LENGTH = 0.0806
const CAPSULE_CENTER_Y = CAPSULE_RADIUS + CAPSULE_LENGTH / 2

const CORRECTION_THRESHOLD = 0.0016
export const TICK_MS = 1000 / TICK_RATE_HZ

export function Player() {
  const groupRef = useRef<THREE.Group>(null)
  const worldRef = useRef<World | null>(null)
  const initializedForRef = useRef<string | null>(null)
  const animStateRef = useRef<AnimationState>('IDLE')

  // ── Tick state ─────────────────────────────────────────────────────────────
  // client_predictive_tick — advances every TICK_MS when we send a `move`.
  const clientPredictiveTickRef = useRef(0)
  // client_world_tick — latest serverTick for which the server's authoritative
  // state has been applied for the local player. Acks with serverTick <= this
  // value are stale and their (x,z) adjustment is ignored.
  const clientWorldTickRef = useRef(0)
  const pendingInputsRef = useRef<MoveInput[]>([])
  const lastTickTimeRef = useRef(0)          // performance.now() at last tick boundary

  // Per-predictive-tick history, pruned as acks arrive.
  const tickInputsRef = useRef<Map<number, MoveInput[]>>(new Map())
  // Local player's predicted (x,z) at the end of each predictive tick. Compared
  // against the server's acked position to decide whether replay is needed.
  const predictedPosPerTickRef = useRef<Map<number, { x: number; z: number }>>(new Map())

  const localColor = useGameStore((s) => s.localColor)
  const hp = useGameStore((s) => (s.playerId ? (s.playerHp[s.playerId] ?? 2) : 2)) as 0 | 1 | 2
  const { sendMove } = useWsSend()
  const [animState, setAnimState] = useState<AnimationState>('IDLE')

  useFrame((state, delta) => {
    const store = useGameStore.getState()
    const playerId = store.playerId
    if (!playerId || !groupRef.current) return

    // Player draw-order layer: offset keeps groupOrder above 0 so players
    // render AFTER scene geometry (ground, walls) — otherwise the ground
    // paints over the heart tip that dangles below the feet. Back players
    // still get a smaller renderOrder than front players, so a front
    // capsule paints over a back heart. Within each group, heart
    // renderOrder=1 sits after capsule renderOrder=0.
    const gp = groupRef.current.position
    const cp = state.camera.position
    groupRef.current.renderOrder = 1000 - Math.hypot(cp.x - gp.x, cp.y - gp.y, cp.z - gp.z)

    // ── Observer mode: no World, no prediction, no sends ────────────────────
    if (store.observerMode) {
      const obsWorld = getClientWorld()
      for (const ack of consumeMoveAcks()) {
        groupRef.current.position.x = ack.x
        groupRef.current.position.z = ack.z
        localPlayerPos.x = ack.x
        localPlayerPos.z = ack.z
        const newRoomId = obsWorld?.resolveRoomSticky(localPlayerPos.roomId, ack.x, ack.z) ?? localPlayerPos.roomId
        if (newRoomId !== localPlayerPos.roomId) {
          localPlayerPos.roomId = newRoomId
          store.setCurrentRoomId(newRoomId)
        }
        for (const event of ack.events) {
          if (event.type === 'update_animation_state' && event.animState !== animStateRef.current) {
            animStateRef.current = event.animState
            setAnimState(event.animState)
          } else if (event.type === 'damage') {
            store.applyDamage(event.targetId, event.newHp)
          }
        }
      }
      return
    }

    if (initializedForRef.current !== playerId) {
      const w = getClientWorld()
      if (!w) return
      if (!w.getPlayer(playerId)) {
        w.addPlayer(playerId, store.initialPosition.x, store.initialPosition.z)
      }
      // Apply any geometry state already received before World was ready.
      const vis = useGameStore.getState().geometryVisibility
      const localOverride = useGameStore.getState().localGeometryOverride
      for (const [geomId, visible] of Object.entries(vis)) {
        if (visible === false) w.toggleGeometryOff(geomId)
      }
      for (const [geomId, ov] of Object.entries(localOverride)) {
        if (ov) w.toggleGeometryOn(geomId, playerId)
        else w.toggleGeometryOff(geomId, playerId)
      }
      for (const id of Object.keys(store.remotePlayers)) {
        if (!w.getPlayer(id)) {
          const pos = getInterpolatedPos(id)
          w.addPlayer(id, pos?.x ?? 0, pos?.z ?? 0)
        }
      }
      worldRef.current = w
      localWorld.current = w
      initializedForRef.current = playerId
      clientPredictiveTickRef.current = 0
      clientWorldTickRef.current = 0
      pendingInputsRef.current = []
      lastTickTimeRef.current = 0
      tickInputsRef.current.clear()
      predictedPosPerTickRef.current.clear()
      animStateRef.current = 'IDLE'
    }
    const world = worldRef.current!

    // ── 1. Apply server acks ─────────────────────────────────────────────────
    // The server buffers every client move between its ticks and processes them
    // sorted by clientTick, so several acks may arrive with the same serverTick.
    // For each batch: prune input history per-ack, apply events once, then pick
    // the single ack with the newest serverTick to drive reconciliation. Acks
    // whose serverTick <= client_world_tick are stale (a newer tick was already
    // played) and their (x,z) adjustment is ignored.
    const acks = consumeMoveAcks()
    let reconcileAck: typeof acks[number] | null = null
    let reconcilePredicted: { x: number; z: number } | undefined = undefined
    for (const ack of acks) {
      const predicted = predictedPosPerTickRef.current.get(ack.clientTick)
      predictedPosPerTickRef.current.delete(ack.clientTick)
      tickInputsRef.current.delete(ack.clientTick)
      for (const event of ack.events) {
        if (event.type === 'damage') store.applyDamage(event.targetId, event.newHp)
      }
      if (ack.serverTick <= clientWorldTickRef.current) continue
      if (
        !reconcileAck ||
        ack.serverTick > reconcileAck.serverTick ||
        (ack.serverTick === reconcileAck.serverTick && ack.clientTick > reconcileAck.clientTick)
      ) {
        reconcileAck = ack
        reconcilePredicted = predicted
      }
    }

    if (reconcileAck) {
      clientWorldTickRef.current = reconcileAck.serverTick
      const needsReplay =
        !reconcilePredicted ||
        Math.hypot(reconcileAck.x - reconcilePredicted.x, reconcileAck.z - reconcilePredicted.z) > CORRECTION_THRESHOLD
      if (needsReplay) {
        // Reset local player to server's authoritative position, and other
        // entities to what the client currently knows (latest interpolated
        // positions from the remote-player buffer). Then replay all unacked
        // client inputs up to client_predictive_tick.
        world.setPlayerPosition(playerId, reconcileAck.x, reconcileAck.z)
        for (const id of Object.keys(store.remotePlayers)) {
          const pos = getInterpolatedPos(id)
          if (pos) world.setPlayerPosition(id, pos.x, pos.z)
        }
        const replayTicks = [...tickInputsRef.current.keys()].sort((a, b) => a - b)
        for (const t of replayTicks) {
          const inputs = tickInputsRef.current.get(t)!
          for (const { jx, jz, dt } of inputs) {
            world.processMove(playerId, jx, jz, dt)
          }
        }
        for (const { jx, jz, dt } of pendingInputsRef.current) {
          world.processMove(playerId, jx, jz, dt)
        }
        const wp = world.getPlayer(playerId)!
        if (Math.hypot(wp.x - groupRef.current.position.x, wp.z - groupRef.current.position.z) > CORRECTION_THRESHOLD) {
          groupRef.current.position.x = wp.x
          groupRef.current.position.z = wp.z
        }
        if (wp.animState !== animStateRef.current) {
          animStateRef.current = wp.animState
          setAnimState(wp.animState)
        }
      }
    }

    // ── 2. Predict this frame ────────────────────────────────────────────────
    if ((store.playerHp[playerId] ?? 2) === 0) {
      const player = world.getPlayer(playerId)!
      groupRef.current.position.x = player.x
      groupRef.current.position.z = player.z
      return
    }

    // Update remote player positions in World for local collision prediction
    for (const id of Object.keys(store.remotePlayers)) {
      const pos = getInterpolatedPos(id)
      if (pos) world.setPlayerPosition(id, pos.x, pos.z)
    }

    let jx: number, jz: number
    if (store.inputMode === 'tap' && store.moveTarget) {
      const p = world.getPlayer(playerId)!
      const dx = store.moveTarget.x - p.x
      const dz = store.moveTarget.z - p.z
      const dist = Math.hypot(dx, dz)
      const ARRIVAL_EPSILON = 0.01
      if (dist < ARRIVAL_EPSILON) {
        store.setMoveTarget(null)
        jx = 0; jz = 0
      } else {
        jx = dx / dist
        jz = dz / dist
      }
    } else {
      jx = store.joystickInput.x
      jz = store.joystickInput.y
    }
    const events = world.processMove(playerId, jx, jz, delta)
    for (const event of events) {
      if (event.type === 'update_animation_state' && event.animState !== animStateRef.current) {
        animStateRef.current = event.animState
        setAnimState(event.animState)
      }
    }

    // Accumulate input for the current tick period
    pendingInputsRef.current.push({ jx, jz, dt: delta })

    // ── 3. Tick boundary: snapshot, store, and send ──────────────────────────
    // Local input is sent at a fixed 20 Hz, period. Variable-rate playback (for
    // remote-world catch-up) lives in positionBuffer.advanceRenderTick — never
    // here. Distorting the user's own input cadence to "catch up" would change
    // what the user actually did.
    const now = performance.now()
    if (lastTickTimeRef.current === 0) lastTickTimeRef.current = now

    if (now - lastTickTimeRef.current >= TICK_MS) {
      lastTickTimeRef.current = now
      const tick = clientPredictiveTickRef.current++

      const inputs = pendingInputsRef.current
      tickInputsRef.current.set(tick, inputs)
      pendingInputsRef.current = []
      sendMove(tick, inputs)

      // Record the local player's predicted end-of-tick position so the next
      // ack for this clientTick can tell whether replay is needed.
      const wp = world.getPlayer(playerId)!
      predictedPosPerTickRef.current.set(tick, { x: wp.x, z: wp.z })
    }

    // ── 4. Update visuals + room tracking ───────────────────────────────────
    const player = world.getPlayer(playerId)!
    groupRef.current.position.x = player.x
    groupRef.current.position.z = player.z
    localPlayerPos.x = player.x
    localPlayerPos.z = player.z

    // World.processMove already applied the sticky room-resolution rule, so
    // read the authoritative result rather than recomputing from position
    // (which would be first-match and wrong in overlap zones).
    const newRoomId = world.getPlayerRoom(playerId) ?? localPlayerPos.roomId
    if (newRoomId !== localPlayerPos.roomId) {
      localPlayerPos.roomId = newRoomId
      store.setCurrentRoomId(newRoomId)
    }
  })

  return (
    <group ref={groupRef} position={[0, CAPSULE_CENTER_Y, 0]}>
      <CapsuleFallback animationState={animState} color={localColor} />
      <HeartSprite hp={hp} />
    </group>
  )
}
