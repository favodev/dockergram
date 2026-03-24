import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import type { Container } from '../store/useDockerStore'

type NodeProps = {
  container: Container
  initialPosition: [number, number, number]
  targetScale: number
  onReady: (id: string, mesh: Mesh) => void
}

function colorForState(state: string): string {
  switch (state) {
    case 'running':
      return '#5af2b5'
    case 'paused':
      return '#f4d35e'
    case 'exited':
    case 'dead':
      return '#ff6b6b'
    default:
      return '#7cc6fe'
  }
}

export default function Node({ container, initialPosition, targetScale, onReady }: NodeProps) {
  const meshRef = useRef<Mesh>(null)

  useEffect(() => {
    if (!meshRef.current) {
      return
    }
    onReady(container.id, meshRef.current)
  }, [container.id, onReady])

  useFrame((_, delta) => {
    if (!meshRef.current) {
      return
    }
    const next = targetScale
    const current = meshRef.current.scale.x
    const lerped = current + (next - current) * Math.min(1, delta * 6)
    meshRef.current.scale.setScalar(lerped)
  })

  return (
    <mesh ref={meshRef} position={initialPosition} castShadow receiveShadow>
      <sphereGeometry args={[1, 24, 24]} />
      <meshStandardMaterial
        color={colorForState(container.state)}
        transparent
        opacity={0.65}
        roughness={0.25}
        metalness={0.35}
      />
    </mesh>
  )
}
