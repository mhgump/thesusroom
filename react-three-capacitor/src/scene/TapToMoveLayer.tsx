import { useEffect, useRef } from 'react'
import { ThreeEvent } from '@react-three/fiber'
import { useGameStore, selectInputBlocked } from '../store/gameStore'

const PLANE_SIZE = 1000

export function TapToMoveLayer() {
  const inputMode = useGameStore((s) => s.inputMode)
  const observerMode = useGameStore((s) => s.observerMode)
  const setMoveTarget = useGameStore((s) => s.setMoveTarget)
  const activePointerRef = useRef<number | null>(null)

  useEffect(() => {
    const unsubscribe = useGameStore.subscribe((state, prev) => {
      if (selectInputBlocked(state) && !selectInputBlocked(prev)) {
        setMoveTarget(null)
      }
    })
    return unsubscribe
  }, [setMoveTarget])

  if (inputMode !== 'tap' || observerMode) return null

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (selectInputBlocked(useGameStore.getState())) return
    e.stopPropagation()
    activePointerRef.current = e.pointerId
    ;(e.target as unknown as Element).setPointerCapture?.(e.pointerId)
    setMoveTarget({ x: e.point.x, z: e.point.z })
  }

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (activePointerRef.current !== e.pointerId) return
    if (selectInputBlocked(useGameStore.getState())) return
    e.stopPropagation()
    setMoveTarget({ x: e.point.x, z: e.point.z })
  }

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    if (activePointerRef.current !== e.pointerId) return
    activePointerRef.current = null
    ;(e.target as unknown as Element).releasePointerCapture?.(e.pointerId)
  }

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}
