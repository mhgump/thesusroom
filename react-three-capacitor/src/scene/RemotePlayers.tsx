import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import type { RemotePlayerInfo } from '../store/gameStore'
import { getInterpolatedPos, consumeRemoteEvents } from '../network/positionBuffer'
import { CapsuleFallback } from './animation/CapsuleFallback'
import type { AnimationState } from '../game/World'
import { getClientWorld } from '../game/clientWorld'
import { HeartSprite } from './HeartSprite'

const CAPSULE_CENTER_Y = 0.0282 + 0.0806 / 2

// Both positions and events play back against a single client-side render-tick
// pointer (positionBuffer.renderTickFloat) that lags the latest received server
// tick by a fixed buffer. No wall clock is consulted.

function RemotePlayerMesh({ info }: { info: RemotePlayerInfo }) {
  const { id, color, initialAnimState, hasHealth } = info
  const groupRef = useRef<THREE.Group>(null)
  const animStateRef = useRef<AnimationState>(initialAnimState)
  const [animState, setAnimState] = useState<AnimationState>(initialAnimState)
  // The remote's sticky-tracked current room, derived each frame from
  // `world.resolveRoomSticky(prev, x, z)`. Using the remote's prior room
  // (not first-match) avoids overlap-zone ambiguity: a remote player in p2
  // whose position happens to fall inside p1's AABB (overlap) stays tracked
  // as p2 as long as p2 still contains the position.
  const priorRoomRef = useRef<string | null>(null)
  const hp = useGameStore((s) => (s.playerHp[id] ?? 2)) as 0 | 1 | 2

  useFrame((state) => {
    const g = groupRef.current
    if (!g) return

    const pos = getInterpolatedPos(id)
    if (pos !== null) {
      g.position.set(pos.x, CAPSULE_CENTER_Y, pos.z)
      const cp = state.camera.position
      g.renderOrder = 1000 - Math.hypot(cp.x - pos.x, cp.y - CAPSULE_CENTER_Y, cp.z - pos.z)
      // Hide the remote when its (sticky-resolved) room is not visible from
      // the viewer's perspective — same predicate as GeometryLayer/GameScene.
      // If the remote is in no room (between rooms / corridor) show them.
      const { currentRoomId, roomVisibility, playerRoomVisibilityOverride } = useGameStore.getState()
      const world = getClientWorld()
      let visible = true
      if (world) {
        const remoteRoom = world.resolveRoomSticky(priorRoomRef.current, pos.x, pos.z)
        priorRoomRef.current = remoteRoom
        if (remoteRoom !== null) {
          const isRoomVisible = (scopedId: string) => {
            const override = playerRoomVisibilityOverride[scopedId]
            if (override !== undefined) return override
            if (world.isRoomOverlapping(scopedId) && scopedId !== currentRoomId) return false
            return roomVisibility[scopedId] !== false
          }
          const adjacent = world.getAdjacentRoomIds(currentRoomId)
          const visibleRoomIds = new Set([currentRoomId, ...adjacent].filter(isRoomVisible))
          visible = visibleRoomIds.has(remoteRoom)
        }
      }
      g.visible = visible
    } else {
      g.visible = false
    }

    const events = consumeRemoteEvents(id)
    for (const event of events) {
      if (event.type === 'update_animation_state' && event.animState !== animStateRef.current) {
        animStateRef.current = event.animState
        setAnimState(event.animState)
      } else if (event.type === 'damage') {
        useGameStore.getState().applyDamage(event.targetId, event.newHp)
      }
    }
  })

  return (
    <group ref={groupRef} visible={false}>
      <CapsuleFallback animationState={animState} color={color} />
      {hasHealth && <HeartSprite hp={hp} />}
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
