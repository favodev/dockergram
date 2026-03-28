import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
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

function hashToUnit(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return ((hash % 1000) + 1000) % 1000 / 1000
}

export default function Node({ container, initialPosition, targetScale, isSelected, onSelect, onReady }: NodeProps) {
  const groupRef = useRef<Group>(null)
  const shellRef = useRef<Object3D>(null)
  const wireRef = useRef<Object3D>(null)
  const coreRef = useRef<Object3D>(null)
  const cpuPercent = container.stats?.cpuPercent ?? 0
  const isRunning = container.state === 'running' || container.state === 'paused'

  const materialVisuals = useMemo(() => {
    const cpuRatio = clamp(cpuPercent / 100, 0, 2)
    const hotMix = clamp(cpuRatio / 1.5, 0, 1)
    const idShift = hashToUnit(container.id || container.name || 'node')

    const base = new Color(colorForState(container.state))
    base.offsetHSL((idShift - 0.5) * 0.14, 0.04, 0)
    const hot = new Color('#ff5b4d')
    const mixed = base.clone().lerp(hot, hotMix)

    return {
      color: `#${mixed.getHexString()}`,
      emissive: `#${base.getHexString()}`,
      emissiveIntensity: (isSelected ? 0.22 : 0.02) + cpuRatio * (isSelected ? 0.68 : 0.28),
      wireColor: `#${base.clone().lerp(new Color('#ffffff'), 0.4).getHexString()}`,
    }
  }, [container.state, cpuPercent, isSelected])

  const shellOpacity = isSelected ? (isRunning ? 0.22 : 0.16) : isRunning ? 0.14 : 0.07
  const wireOpacity = isSelected ? (isRunning ? 0.72 : 0.52) : isRunning ? 0.4 : 0.2
  const coreOpacity = isRunning ? 0.78 : 0.38
  const coreBaseIntensity = isRunning ? 0.44 : 0.18

  const label = (container.name || container.id.slice(0, 8) || 'container').replace(/^\//, '')

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
          opacity={shellOpacity}
          roughness={0.05}
          metalness={0.55}
          clearcoat={1}
          clearcoatRoughness={0.2}
        />
      </mesh>

      <mesh ref={wireRef}>
        <icosahedronGeometry args={[1.16, 1]} />
        <meshBasicMaterial color={materialVisuals.wireColor} wireframe transparent opacity={wireOpacity} />
      </mesh>

      <mesh ref={coreRef}>
        <sphereGeometry args={[0.38, 16, 16]} />
        <meshStandardMaterial
          color={materialVisuals.emissive}
          emissive={materialVisuals.emissive}
          emissiveIntensity={coreBaseIntensity + clamp(cpuPercent / 100, 0, 2) * (isRunning ? 0.9 : 0.35) + (isSelected ? 0.22 : 0)}
          roughness={0.12}
          metalness={0.2}
          transparent
          opacity={coreOpacity}
        />
      </mesh>

      <Billboard position={[0, 1.78, 0]}>
        <Text
          fontSize={0.18}
          color={isSelected ? '#ffffff' : '#d8f3ff'}
          anchorX="center"
          anchorY="middle"
          maxWidth={3.6}
          lineHeight={1}
          outlineColor="#020611"
          outlineWidth={0.022}
          fillOpacity={isSelected ? 1 : 0.8}
          material-depthTest={false}
          renderOrder={20}
        >
          {label}
        </Text>
      </Billboard>
    </group>
  )
}
