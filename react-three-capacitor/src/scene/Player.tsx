import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import { World, TICK_RATE_HZ } from '../game/World'
import type { AnimationState, MoveInput } from '../game/World'
import { CapsuleFallback } from './animation/CapsuleFallback'
import { useWsSend } from '../network/useWebSocket'
import { consumeMoveAck, getInterpolatedPos, getAdaptiveDelayMs } from '../network/positionBuffer'
import { localPlayerPos } from '../game/localPlayerPos'
import { CURRENT_MAP } from '../../../content/client/maps'
import { hudRegistry } from './hudRegistry'
import { CAMERA_ANGLE } from '../game/constants'
import { localWorld } from '../game/localWorld'

const HEART_WORLD_SIZE = 0.0282
const BASE_HEART_PX = 20
const _hv = new THREE.Vector3()

const CAPSULE_RADIUS = 0.0282
const CAPSULE_LENGTH = 0.0806
const CAPSULE_CENTER_Y = CAPSULE_RADIUS + CAPSULE_LENGTH / 2

const CORRECTION_THRESHOLD = 0.0016
export const TICK_MS = 1000 / TICK_RATE_HZ

/**
 * Compute the effective client tick duration (ms) given the current backlog
 * between the latest server-acked tick and the latest locally-generated tick.
 *
 * When the client falls behind (large backlog relative to the adaptive buffer),
 * we tick faster to catch up:
 *   - diff < 1.5× target → 1.0× speed (normal TICK_MS)
 *   - diff ≥ 3.0× target → 2.0× speed (TICK_MS / 2)
 *   - linear interpolation between those bounds
 *
 * adaptiveDelayMs MUST be the live value from getAdaptiveDelayMs() — never
 * a cached/hardcoded constant — so the buffer target tracks current network
 * conditions.
 */
export function computeTickDurationMs(
  latestAckedTick: number,
  currentTick: number,
  adaptiveDelayMs: number,
): number {
  const diff = Math.max(0, (currentTick - 1) - latestAckedTick)
  const targetBufferTicks = adaptiveDelayMs / TICK_MS
  const lo = 1.5 * targetBufferTicks
  const hi = 3.0 * targetBufferTicks
  let speed: number
  if (diff < lo) {
    speed = 1.0
  } else if (diff >= hi) {
    speed = 2.0
  } else {
    // Linear interp: at diff=lo speed=1.0, at diff=hi speed=2.0
    speed = 1.0 + (diff - lo) / (hi - lo)
  }
  return TICK_MS / speed
}

// ── Per-tick entity snapshot ─────────────────────────────────────────────────

type EntityState = { x: number; z: number; animState: AnimationState; hp: 0 | 1 | 2 }
type TickSnapshot = Map<string, EntityState>

function captureSnapshot(world: World): TickSnapshot {
  const snap: TickSnapshot = new Map()
  for (const [id, p] of world.players) {
    snap.set(id, { x: p.x, z: p.z, animState: p.animState, hp: p.hp })
  }
  return snap
}

function restoreSnapshot(world: World, snap: TickSnapshot): void {
  for (const [id, state] of snap) {
    const p = world.getPlayer(id)
    if (!p) continue
    world.setPlayerPosition(id, state.x, state.z)
    p.animState = state.animState
    p.hp = state.hp
  }
}

function clearOldHistory(
  tickInputs: Map<number, MoveInput[]>,
  tickSnapshots: Map<number, TickSnapshot>,
  upToTick: number,
): void {
  for (const t of tickInputs.keys()) { if (t <= upToTick) tickInputs.delete(t) }
  for (const t of tickSnapshots.keys()) { if (t <= upToTick) tickSnapshots.delete(t) }
}

export function Player() {
  const groupRef = useRef<THREE.Group>(null)
  const worldRef = useRef<World | null>(null)
  const initializedForRef = useRef<string | null>(null)
  const animStateRef = useRef<AnimationState>('IDLE')
  const appliedWalkableRef = useRef<import('../game/WorldSpec').WalkableArea | null>(null)

  // ── Tick state ─────────────────────────────────────────────────────────────
  const currentTickRef = useRef(0)
  const pendingInputsRef = useRef<MoveInput[]>([])
  const lastTickTimeRef = useRef(0)          // performance.now() at last tick boundary
  const latestAckedTickRef = useRef(-1)

  // Per-tick history
  const tickInputsRef = useRef<Map<number, MoveInput[]>>(new Map())
  const tickSnapshotsRef = useRef<Map<number, TickSnapshot>>(new Map())

  const localColor = useGameStore((s) => s.localColor)
  const { sendMove } = useWsSend()
  const [animState, setAnimState] = useState<AnimationState>('IDLE')

  useFrame((state, delta) => {
    const store = useGameStore.getState()
    const playerId = store.playerId
    if (!playerId || !groupRef.current) return

    // ── Observer mode: no World, no prediction, no sends ────────────────────
    if (store.observerMode) {
      const ack = consumeMoveAck()
      if (ack) {
        groupRef.current.position.x = ack.x
        groupRef.current.position.z = ack.z
        localPlayerPos.x = ack.x
        localPlayerPos.z = ack.z
        const newRoomId = CURRENT_MAP.getRoomAtPosition(ack.x, ack.z) ?? localPlayerPos.roomId
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
      const heartDiv = hudRegistry.get('__local__')
      if (heartDiv) {
        const { camera, size } = state
        if (camera instanceof THREE.OrthographicCamera) {
          camera.updateMatrixWorld()
          _hv.set(groupRef.current.position.x, 0, groupRef.current.position.z).project(camera)
          const sx = (_hv.x * 0.5 + 0.5) * size.width
          const sy = (-_hv.y * 0.5 + 0.5) * size.height
          const scale = (HEART_WORLD_SIZE * size.height / Math.cos(CAMERA_ANGLE)) / BASE_HEART_PX
          heartDiv.style.transform = `translate(${sx}px,${sy}px) translate(-50%,-50%) scale(${scale})`
          if (heartDiv.style.display === 'none') heartDiv.style.display = ''
        }
      }
      return
    }

    if (initializedForRef.current !== playerId) {
      const w = CURRENT_MAP.physics
        ? World.withPhysics(CURRENT_MAP.walkable, CURRENT_MAP.physics, ['touched'])
        : new World(CURRENT_MAP.walkable, ['touched'])
      w.addPlayer(playerId, store.initialPosition.x, store.initialPosition.z)
      // Apply any geometry state already received before World was ready.
      if (CURRENT_MAP.physics) {
        const vis = useGameStore.getState().geometryVisibility
        const localOverride = useGameStore.getState().localGeometryOverride
        for (const geom of CURRENT_MAP.physics.geometry) {
          if (vis[geom.id] === false) w.toggleGeometryOff(geom.id)
          const ov = localOverride[geom.id]
          if (ov !== undefined) {
            if (ov) w.toggleGeometryOn(geom.id, playerId)
            else w.toggleGeometryOff(geom.id, playerId)
          }
        }
      }
      for (const id of Object.keys(store.remotePlayers)) {
        const pos = getInterpolatedPos(id, getAdaptiveDelayMs())
        w.addPlayer(id, pos?.x ?? 0, pos?.z ?? 0)
      }
      worldRef.current = w
      localWorld.current = w
      initializedForRef.current = playerId
      currentTickRef.current = 0
      pendingInputsRef.current = []
      lastTickTimeRef.current = 0
      latestAckedTickRef.current = -1
      tickInputsRef.current.clear()
      tickSnapshotsRef.current.clear()
      animStateRef.current = 'IDLE'
      appliedWalkableRef.current = null
    }
    const world = worldRef.current!

    // ── Sync walkable area when it changes (AABB mode) ───────────────────────
    const currentWalkable = store.activeWalkable ?? CURRENT_MAP.walkable
    if (currentWalkable !== appliedWalkableRef.current) {
      world.setWalkable(currentWalkable)
      world.snapAllPlayers()
      appliedWalkableRef.current = currentWalkable
    }

    // ── 1. Apply server ack ──────────────────────────────────────────────────
    const ack = consumeMoveAck()
    if (ack) {
      const snapshot = tickSnapshotsRef.current.get(ack.tick)
      if (snapshot) {
        const predicted = snapshot.get(playerId)
        if (predicted && Math.hypot(ack.x - predicted.x, ack.z - predicted.z) > CORRECTION_THRESHOLD) {
          // Restore world to the snapshot for the acked tick, then apply server's authoritative position
          restoreSnapshot(world, snapshot)
          world.setPlayerPosition(playerId, ack.x, ack.z)

          // Replay subsequent ticks' inputs to reconstruct current state
          for (let t = ack.tick + 1; t < currentTickRef.current; t++) {
            const tickSnap = tickSnapshotsRef.current.get(t)
            if (tickSnap) {
              for (const [id, s] of tickSnap) {
                if (id === playerId) continue
                const rp = world.getPlayer(id)
                if (rp) {
                  world.setPlayerPosition(id, s.x, s.z)
                  rp.animState = s.animState
                  rp.hp = s.hp
                }
              }
            }
            const inputs = tickInputsRef.current.get(t) ?? []
            for (const { jx, jz, dt } of inputs) {
              world.processMove(playerId, jx, jz, dt)
            }
          }

          // Replay inputs accumulated in the current (unsent) tick
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

      // Mark tick as acknowledged and prune history
      latestAckedTickRef.current = ack.tick
      clearOldHistory(tickInputsRef.current, tickSnapshotsRef.current, ack.tick)

      // Apply authoritative events from the ack
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

    // Update remote player positions in World for local collision prediction
    for (const id of Object.keys(store.remotePlayers)) {
      const pos = getInterpolatedPos(id, getAdaptiveDelayMs())
      if (pos) world.setPlayerPosition(id, pos.x, pos.z)
    }

    const { x: jx, y: jz } = store.joystickInput
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
    const now = performance.now()
    if (lastTickTimeRef.current === 0) lastTickTimeRef.current = now

    const tickDurationMs = computeTickDurationMs(
      latestAckedTickRef.current,
      currentTickRef.current,
      getAdaptiveDelayMs(),
    )
    if (now - lastTickTimeRef.current >= tickDurationMs) {
      lastTickTimeRef.current = now
      const tick = currentTickRef.current++

      // Snapshot world state at the end of this tick
      tickSnapshotsRef.current.set(tick, captureSnapshot(world))

      // Store the inputs for this tick and send to server
      const inputs = pendingInputsRef.current
      tickInputsRef.current.set(tick, inputs)
      pendingInputsRef.current = []
      sendMove(tick, inputs)
    }

    // ── 4. Update visuals + room tracking ───────────────────────────────────
    const player = world.getPlayer(playerId)!
    groupRef.current.position.x = player.x
    groupRef.current.position.z = player.z
    localPlayerPos.x = player.x
    localPlayerPos.z = player.z

    const heartDiv = hudRegistry.get('__local__')
    if (heartDiv) {
      const { camera, size } = state
      if (camera instanceof THREE.OrthographicCamera) {
        camera.updateMatrixWorld()
        _hv.set(player.x, 0, player.z).project(camera)
        const sx = (_hv.x * 0.5 + 0.5) * size.width
        const sy = (-_hv.y * 0.5 + 0.5) * size.height
        const scale = (HEART_WORLD_SIZE * size.height / Math.cos(CAMERA_ANGLE)) / BASE_HEART_PX
        heartDiv.style.transform = `translate(${sx}px,${sy}px) translate(-50%,-50%) scale(${scale})`
        if (heartDiv.style.display === 'none') heartDiv.style.display = ''
      }
    }

    const newRoomId = CURRENT_MAP.getRoomAtPosition(player.x, player.z) ?? localPlayerPos.roomId
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
