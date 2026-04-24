import { Text } from '@react-three/drei'
import { useClientWorld } from '../game/clientWorld'

interface Props { visibleIds: Set<string> }

export function VoteRegions({ visibleIds }: Props) {
  const world = useClientWorld()
  const regions = world?.getAllVoteRegions() ?? []
  return (
    <>
      {regions.filter(region => visibleIds.has(region.roomId ?? '')).map(region => (
        <group key={region.id} position={[region.x, 0, region.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
            <circleGeometry args={[region.radius, 64]} />
            <meshBasicMaterial color={region.color} transparent opacity={0.35} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
            <ringGeometry args={[region.radius * 0.9625, region.radius, 64]} />
            <meshBasicMaterial color={region.color} />
          </mesh>
          <Text
            position={[0, 0.004, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={region.radius * 0.8}
            color={region.color}
            anchorX="center"
            anchorY="middle"
            font={undefined}
          >
            {region.label}
          </Text>
        </group>
      ))}
    </>
  )
}
