import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, Group, type Object3D } from 'three'
import type { Container } from '../store/useDockerStore'

type NodeProps = {
  container: Container
  initialPosition: [number, number, number]
  targetScale: number
  isSelected: boolean
  onSelect: (id: string) => void
  onReady: (id: string, object: Object3D) => void
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

export default function Node({ container, initialPosition, targetScale, isSelected, onSelect, onReady }: NodeProps) {
  const groupRef = useRef<Group>(null)
  const shellRef = useRef<Object3D>(null)
  const wireRef = useRef<Object3D>(null)
  const coreRef = useRef<Object3D>(null)
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
      emissiveIntensity: (isSelected ? 0.55 : 0.2) + cpuRatio * 1.7,
      wireColor: `#${base.clone().lerp(new Color('#ffffff'), 0.4).getHexString()}`,
    }
  }, [container.state, cpuPercent, isSelected])

  useEffect(() => {
    if (!groupRef.current) {
      return
    }
    onReady(container.id, groupRef.current)
  }, [container.id, onReady])

  useFrame((state, delta) => {
    if (!groupRef.current) {
      return
    }

    const next = targetScale
    const current = groupRef.current.scale.x
    const lerped = current + (next - current) * Math.min(1, delta * 6)
    groupRef.current.scale.setScalar(lerped)

    const t = state.clock.getElapsedTime()
    const cpuRatio = clamp(cpuPercent / 100, 0, 2)

    if (shellRef.current) {
      shellRef.current.rotation.y += delta * (0.24 + cpuRatio * 0.12)
      shellRef.current.rotation.x += delta * 0.06
    }

    if (wireRef.current) {
      wireRef.current.rotation.y -= delta * (0.32 + cpuRatio * 0.18)
      wireRef.current.rotation.z += delta * 0.08
    }

    if (coreRef.current) {
      const pulse = 0.34 + Math.sin(t * (2.2 + cpuRatio * 3.1)) * 0.08 + cpuRatio * 0.12
      coreRef.current.scale.setScalar(clamp(pulse, 0.24, 0.92))
    }
  })

  return (
    <group
      ref={groupRef}
      position={initialPosition}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(container.id)
      }}
    >
      <mesh ref={shellRef} castShadow receiveShadow>
        <icosahedronGeometry args={[1.05, 2]} />
        <meshPhysicalMaterial
          color={materialVisuals.color}
          emissive={materialVisuals.emissive}
          emissiveIntensity={materialVisuals.emissiveIntensity}
          transparent
          opacity={0.22}
          roughness={0.05}
          metalness={0.55}
          clearcoat={1}
          clearcoatRoughness={0.2}
        />
      </mesh>

      <mesh ref={wireRef}>
        <icosahedronGeometry args={[1.16, 1]} />
        <meshBasicMaterial color={materialVisuals.wireColor} wireframe transparent opacity={isSelected ? 0.75 : 0.42} />
      </mesh>

      <mesh ref={coreRef}>
        <sphereGeometry args={[0.38, 16, 16]} />
        <meshStandardMaterial
          color={materialVisuals.emissive}
          emissive={materialVisuals.emissive}
          emissiveIntensity={1.8 + clamp(cpuPercent / 100, 0, 2) * 3.1}
          roughness={0.12}
          metalness={0.2}
          transparent
          opacity={0.9}
        />
      </mesh>
    </group>
  )
}
