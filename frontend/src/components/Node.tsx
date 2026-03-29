import { useEffect, useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Group, type Object3D } from 'three'
import type { Container } from '../store/useDockerStore'

type NodeProps = {
  container: Container
  initialPosition: [number, number, number]
  targetScale: number
  isSelected: boolean
  isDimmed: boolean
  onSelect: (id: string) => void
  onReady: (id: string, object: Object3D) => void
}

export default function Node({ container, initialPosition, targetScale, isSelected, isDimmed, onSelect, onReady }: NodeProps) {
  const groupRef = useRef<Group>(null)
  const shellRef = useRef<Object3D>(null)
  const wireRef = useRef<Object3D>(null)
  const ringRef = useRef<Object3D>(null)
  const transitionPulseRef = useRef(0)
  const previousRunningRef = useRef<boolean>(container.state === 'running' || container.state === 'paused')
  const isRunning = container.state === 'running' || container.state === 'paused'
  const nodeColor = isRunning ? '#39d98a' : '#ff6b6b'
  const opacity = isDimmed ? 0.35 : 0.95
  const label = (container.name || container.id.slice(0, 8) || 'container').replace(/^\//, '')

  useEffect(() => {
    if (!groupRef.current) {
      return
    }
    onReady(container.id, groupRef.current)
  }, [container.id, onReady])

  useEffect(() => {
    if (previousRunningRef.current !== isRunning) {
      transitionPulseRef.current = 1
      previousRunningRef.current = isRunning
    }
  }, [isRunning])

  useFrame((_, delta) => {
    if (!groupRef.current) {
      return
    }

    const shell = shellRef.current
    if (shell) {
      shell.rotation.y += delta * 0.42
      shell.rotation.x += delta * 0.08
    }

    const wire = wireRef.current
    if (wire) {
      wire.rotation.y -= delta * 0.55
      wire.rotation.z += delta * 0.12
    }

    if (ringRef.current && isSelected) {
      ringRef.current.rotation.z += delta * 0.9
    }

    transitionPulseRef.current = Math.max(0, transitionPulseRef.current - delta * 2.4)
    const pulseProgress = 1 - transitionPulseRef.current
    const pulseScale = transitionPulseRef.current > 0 ? 1 + Math.sin(pulseProgress * Math.PI) * 0.14 : 1

    const baseScale = targetScale
    const desiredScale = baseScale * pulseScale
    const currentScale = groupRef.current.scale.x || desiredScale
    const nextScale = currentScale + (desiredScale - currentScale) * Math.min(1, delta * 9)
    groupRef.current.scale.setScalar(nextScale)
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
      <mesh ref={shellRef}>
        <sphereGeometry args={[0.95, 20, 20]} />
        <meshStandardMaterial color={nodeColor} emissive={nodeColor} emissiveIntensity={isSelected ? 0.5 : 0.2} transparent opacity={opacity} />
      </mesh>

      <mesh ref={wireRef}>
        <sphereGeometry args={[1.1, 14, 14]} />
        <meshBasicMaterial color="#d9f5ff" wireframe transparent opacity={isDimmed ? 0.2 : 0.52} />
      </mesh>

      {isSelected ? (
        <mesh ref={ringRef} position={[0, -1.18, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.1, 1.34, 48]} />
          <meshBasicMaterial color="#ffe49d" transparent opacity={0.92} />
        </mesh>
      ) : null}

      <Html position={[0, 1.45, 0]} center distanceFactor={18} style={{ pointerEvents: 'none' }}>
        <div className={`node-tag ${isRunning ? 'run' : 'off'} ${isSelected ? 'selected' : ''}`}>{label}</div>
      </Html>
    </group>
  )
}
