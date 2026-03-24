import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, type Mesh } from 'three'
import type { Container } from '../store/useDockerStore'

type NodeProps = {
  container: Container
  initialPosition: [number, number, number]
  targetScale: number
  onReady: (id: string, mesh: Mesh) => void
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
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
  const cpuPercent = container.stats?.cpuPercent ?? 0

  const materialVisuals = useMemo(() => {
    const cpuRatio = clamp(cpuPercent / 100, 0, 2)
    const hotMix = clamp(cpuRatio / 1.5, 0, 1)

    const base = new Color(colorForState(container.state))
    const hot = new Color('#ff5b4d')
    const mixed = base.clone().lerp(hot, hotMix)

    return {
      color: `#${mixed.getHexString()}`,
      emissive: `#${base.getHexString()}`,
      emissiveIntensity: 0.2 + cpuRatio * 1.7,
    }
  }, [container.state, cpuPercent])

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
        color={materialVisuals.color}
        emissive={materialVisuals.emissive}
        emissiveIntensity={materialVisuals.emissiveIntensity}
        transparent
        opacity={0.72}
        roughness={0.2}
        metalness={0.45}
      />
    </mesh>
  )
}
