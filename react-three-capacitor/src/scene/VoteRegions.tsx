import { Text } from '@react-three/drei'
import { DEFAULT_GAME_SPEC } from '../game/DefaultGame'

export function VoteRegions() {
  return (
    <>
      {DEFAULT_GAME_SPEC.voteRegions.map(region => (
        <group key={region.id} position={[region.x, 0, region.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
            <circleGeometry args={[region.radius, 64]} />
            <meshBasicMaterial color={region.color} transparent opacity={0.35} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
            <ringGeometry args={[region.radius - 0.12, region.radius, 64]} />
            <meshBasicMaterial color={region.color} />
          </mesh>
          <Text
            position={[0, 0.004, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={1.5}
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
