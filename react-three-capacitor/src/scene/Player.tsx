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
import { CURRENT_MAP } from '../../../content/client/maps'
import { localWorld } from '../game/localWorld'
import { HeartSprite } from './HeartSprite'

const CAPSULE_RADIUS = 0.0282
const CAPSULE_LENGTH = 0.0806
const CAPSULE_CENTER_Y = CAPSULE_RADIUS + CAPSULE_LENGTH / 2

const CORRECTION_THRESHOLD = 0.0016
export const TICK_MS = 1000 / TICK_RATE_HZ

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

  // Per-tick history
  const tickInputsRef = useRef<Map<number, MoveInput[]>>(new Map())
  const tickSnapshotsRef = useRef<Map<number, TickSnapshot>>(new Map())

  const localColor = useGameStore((s) => s.localColor)
  const hp = useGameStore((s) => (s.playerId ? (s.playerHp[s.playerId] ?? 2) : 2)) as 0 | 1 | 2
  const { sendMove } = useWsSend()
  const [animState, setAnimState] = useState<AnimationState>('IDLE')

  useFrame((_, delta) => {
    const store = useGameStore.getState()
    const playerId = store.playerId
    if (!playerId || !groupRef.current) return

    // ── Observer mode: no World, no prediction, no sends ────────────────────
    if (store.observerMode) {
      for (const ack of consumeMoveAcks()) {
        if (ack.outOfOrder) continue
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
        const pos = getInterpolatedPos(id)
        w.addPlayer(id, pos?.x ?? 0, pos?.z ?? 0)
      }
      worldRef.current = w
      localWorld.current = w
      initializedForRef.current = playerId
      currentTickRef.current = 0
      pendingInputsRef.current = []
      lastTickTimeRef.current = 0
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

    // ── 1. Apply server acks ─────────────────────────────────────────────────
    // outOfOrder acks: server received but didn't apply this tick (a newer one
    // displaced it). Drop the tick from local history so reconciliation never
    // tries to use the stale snapshot — but skip the position-correction path.
    for (const ack of consumeMoveAcks()) {
      if (ack.outOfOrder) {
        tickInputsRef.current.delete(ack.tick)
        tickSnapshotsRef.current.delete(ack.tick)
        continue
      }
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

      // Prune history through the acked tick
      clearOldHistory(tickInputsRef.current, tickSnapshotsRef.current, ack.tick)

      // Apply authoritative events from the ack
      for (const event of ack.events) {
        if (event.type === 'damage') store.applyDamage(event.targetId, event.newHp)
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

    const newRoomId = CURRENT_MAP.getRoomAtPosition(player.x, player.z) ?? localPlayerPos.roomId
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
