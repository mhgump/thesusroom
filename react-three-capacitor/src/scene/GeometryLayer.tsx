import { useMemo } from 'react'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import { CURRENT_MAP } from '../../../content/maps'
import { Textures } from '../game/textures'

function makeWallMaterials(): THREE.Material[] {
  const side = new THREE.MeshLambertMaterial({ map: Textures.barrierSide() })
  const top = new THREE.MeshLambertMaterial({ map: Textures.barrierTop() })
  const hidden = new THREE.MeshLambertMaterial({ visible: false })
  return [side, side, top, hidden, side, side]
}

export function GeometryLayer() {
  const geometryObjects = useGameStore((s) => s.geometryObjects)
  const geometryVisibility = useGameStore((s) => s.geometryVisibility)
  const localGeometryOverride = useGameStore((s) => s.localGeometryOverride)
  const currentRoomId = useGameStore((s) => s.currentRoomId)
  const roomVisibility = useGameStore((s) => s.roomVisibility)
  const playerRoomVisibilityOverride = useGameStore((s) => s.playerRoomVisibilityOverride)
  const wallMats = useMemo(makeWallMaterials, [])
  const colorMaterialCache = useMemo(() => new Map<string, THREE.Material>(), [])

  const isRoomVisible = (scopedId: string) => {
    const override = playerRoomVisibilityOverride[scopedId]
    if (override !== undefined) return override
    if (CURRENT_MAP.isRoomOverlapping(scopedId) && scopedId !== currentRoomId) return false
    return roomVisibility[scopedId] !== false
  }
  const visibleRoomIds = new Set(
    [currentRoomId, ...CURRENT_MAP.getAdjacentRoomIds(currentRoomId)].filter(isRoomVisible),
  )

  const getColorMaterial = (color: string): THREE.Material => {
    let m = colorMaterialCache.get(color)
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color })
      colorMaterialCache.set(color, m)
    }
    return m
  }

  return (
    <>
      {geometryObjects.map((obj) => {
        const effectiveVisible = localGeometryOverride[obj.id] ?? geometryVisibility[obj.id]
        if (effectiveVisible === false) return null
        if (!visibleRoomIds.has(obj.roomId)) return null
        const material = obj.color ? getColorMaterial(obj.color) : wallMats
        return (
          <mesh
            key={obj.id}
            material={material}
            position={[obj.cx, obj.cy, obj.cz]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[obj.width, obj.height, obj.depth]} />
          </mesh>
        )
      })}
    </>
  )
}
