import { useCallback, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls, Stars } from '@react-three/drei'
import type { Object3D } from 'three'
import Node from './components/Node'
import { useDockerStore, type Container } from './store/useDockerStore'
const EMPTY_CONTAINERS: Container[] = []

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function sizeFromMemLimit(memLimit: number): number {
  if (!memLimit || memLimit <= 0) {
    return 0.75
  }
  const gib = memLimit / (1024 * 1024 * 1024)
  return clamp(0.6 + Math.cbrt(gib) * 0.45, 0.6, 2.2)
}

function ForceGraph({
  containers,
  selectedContainerId,
  onSelectContainer,
}: {
  containers: Container[]
  selectedContainerId: string | null
  onSelectContainer: (id: string) => void
}) {
  const positioned = useMemo(() => {
    const ordered = [...containers].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
    const count = Math.max(1, ordered.length)
    const cols = Math.ceil(Math.sqrt(count))
    const rows = Math.ceil(count / cols)
    const spacing = 4.6
    const startX = -((cols - 1) * spacing) / 2
    const startZ = -((rows - 1) * spacing) / 2

    return ordered.map((container, idx) => {
      const col = idx % cols
      const row = Math.floor(idx / cols)
      const x = startX + col * spacing
      const z = startZ + row * spacing
      const y = (row % 2 === 0 ? 0.35 : -0.35)
      return {
        container,
        position: [x, y, z] as [number, number, number],
      }
    })
  }, [containers])

  const handleReady = useCallback<((id: string, object: Object3D) => void)>(() => {
    // Stable layout: no runtime position handoff needed.
  }, [])

  const nodes = positioned.map(({ container, position }) => {
    const targetScale = sizeFromMemLimit(container.stats?.memLimit ?? 0)

    return (
      <Node
        key={container.id}
        container={container}
        initialPosition={position}
        targetScale={targetScale}
        isSelected={selectedContainerId === container.id}
        isDimmed={selectedContainerId !== null && selectedContainerId !== container.id}
        onSelect={onSelectContainer}
        onReady={handleReady}
      />
    )
  })

  return (
    <>
      {nodes}
    </>
  )
}

export default function Scene() {
  const containers = useDockerStore((s) => s.state?.containers ?? EMPTY_CONTAINERS)
  const selectedContainerId = useDockerStore((s) => s.selectedContainerId)
  const setSelectedContainerId = useDockerStore((s) => s.setSelectedContainerId)

  return (
    <Canvas
      dpr={[1, 1.35]}
      camera={{ position: [0, 8, 22], fov: 55 }}
      onPointerMissed={() => setSelectedContainerId(null)}
    >
      <color attach="background" args={['#05070d']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[6, 12, 8]} intensity={1.25} color="#c7f3ff" />
      <pointLight position={[-8, 2, -6]} intensity={0.55} color="#53e0ff" />
      <Stars radius={70} depth={40} count={120} factor={1.1} saturation={0} fade speed={0.12} />
      <Grid
        position={[0, -6.2, 0]}
        args={[64, 64]}
        cellSize={1.2}
        cellThickness={0.18}
        cellColor="#0e2f54"
        sectionSize={6}
        sectionThickness={0.45}
        sectionColor="#266aa3"
        fadeDistance={45}
        fadeStrength={0.95}
        infiniteGrid
      />
      <ForceGraph containers={containers} selectedContainerId={selectedContainerId} onSelectContainer={setSelectedContainerId} />
      <OrbitControls target={[0, 0, 0]} enableDamping dampingFactor={0.08} maxDistance={52} minDistance={10} />
    </Canvas>
  )
}
