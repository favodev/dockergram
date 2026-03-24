import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Vector3, type Mesh } from 'three'
import Node from './components/Node'
import { useDockerStore, type Container } from './store/useDockerStore'

type Body = {
  id: string
  position: Vector3
  velocity: Vector3
  targetScale: number
  mesh?: Mesh
}

const TMP = new Vector3()
const EMPTY_CONTAINERS: Container[] = []

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function randomSpawn(radius = 8): Vector3 {
  const theta = Math.random() * Math.PI * 2
  const phi = Math.acos(2 * Math.random() - 1)
  const r = radius * (0.6 + Math.random() * 0.4)
  return new Vector3(
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi) * 0.7,
    r * Math.sin(phi) * Math.sin(theta),
  )
}

function sizeFromMemLimit(memLimit: number): number {
  if (!memLimit || memLimit <= 0) {
    return 0.75
  }
  const gib = memLimit / (1024 * 1024 * 1024)
  return clamp(0.6 + Math.cbrt(gib) * 0.45, 0.6, 2.2)
}

function ForceGraph({ containers }: { containers: Container[] }) {
  const bodiesRef = useRef<Map<string, Body>>(new Map())

  useEffect(() => {
    const map = bodiesRef.current
    const nextIDs = new Set(containers.map((c) => c.id))

    containers.forEach((container) => {
      const existing = map.get(container.id)
      if (existing) {
        existing.targetScale = sizeFromMemLimit(container.stats?.memLimit ?? 0)
        return
      }
      map.set(container.id, {
        id: container.id,
        position: randomSpawn(8 + Math.random() * 2),
        velocity: new Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4),
        targetScale: sizeFromMemLimit(container.stats?.memLimit ?? 0),
      })
    })

    for (const id of map.keys()) {
      if (!nextIDs.has(id)) {
        map.delete(id)
      }
    }
  }, [containers])

  useFrame((_, delta) => {
    const bodies = Array.from(bodiesRef.current.values())
    if (bodies.length === 0) {
      return
    }

    const repulsion = 6
    const centerPull = 0.9
    const maxSpeed = 5

    for (let i = 0; i < bodies.length; i += 1) {
      const a = bodies[i]

      for (let j = i + 1; j < bodies.length; j += 1) {
        const b = bodies[j]
        TMP.copy(a.position).sub(b.position)
        const distSq = clamp(TMP.lengthSq(), 0.18, 999999)
        const force = repulsion / distSq

        TMP.normalize().multiplyScalar(force * delta)
        a.velocity.add(TMP)
        b.velocity.sub(TMP)
      }
    }

    for (const body of bodies) {
      body.velocity.addScaledVector(body.position, -centerPull * delta)
      const damping = Math.exp(-2.4 * delta)
      body.velocity.multiplyScalar(damping)

      if (body.velocity.length() > maxSpeed) {
        body.velocity.setLength(maxSpeed)
      }

      body.position.addScaledVector(body.velocity, delta)
      if (body.mesh) {
        body.mesh.position.lerp(body.position, Math.min(1, delta * 10))
      }
    }
  })

  const nodes = useMemo(
    () =>
      containers.map((container) => {
        const body = bodiesRef.current.get(container.id)
        const initial = body ? body.position : randomSpawn()

        return (
          <Node
            key={container.id}
            container={container}
            initialPosition={[initial.x, initial.y, initial.z]}
            targetScale={body?.targetScale ?? sizeFromMemLimit(container.stats?.memLimit ?? 0)}
            onReady={(id, mesh) => {
              const current = bodiesRef.current.get(id)
              if (!current) {
                return
              }
              current.mesh = mesh
              mesh.position.copy(current.position)
            }}
          />
        )
      }),
    [containers],
  )

  return <>{nodes}</>
}

export default function Scene() {
  const containers = useDockerStore((s) => s.state?.containers ?? EMPTY_CONTAINERS)

  return (
    <Canvas shadows dpr={[1, 1.8]} camera={{ position: [0, 3, 16], fov: 52 }}>
      <color attach="background" args={['#05070d']} />
      <fog attach="fog" args={['#05070d', 14, 34]} />
      <ambientLight intensity={0.38} />
      <directionalLight position={[8, 12, 5]} intensity={1.25} />
      <pointLight position={[-10, -4, -5]} intensity={0.45} color="#53e0ff" />
      <ForceGraph containers={containers} />
      <OrbitControls enableDamping dampingFactor={0.08} maxDistance={40} minDistance={6} />
    </Canvas>
  )
}
