import { useMemo } from 'react'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
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
  const wallMats = useMemo(makeWallMaterials, [])

  return (
    <>
      {geometryObjects.map((obj) => {
        if (geometryVisibility[obj.id] === false) return null
        if (obj.height != null && obj.height > 0) {
          return (
            <mesh
              key={obj.id}
              material={wallMats}
              position={[obj.x, obj.height / 2, obj.z]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[obj.width, obj.height, obj.depth]} />
            </mesh>
          )
        }
        return (
          <mesh
            key={obj.id}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[obj.x, 0.004, obj.z]}
          >
            <planeGeometry args={[obj.width, obj.depth]} />
            <meshBasicMaterial color={obj.color} transparent opacity={0.45} />
          </mesh>
        )
      })}
    </>
  )
}
