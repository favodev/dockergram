import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Grid, OrbitControls, Stars } from '@react-three/drei'
import {
  BufferGeometry,
  Float32BufferAttribute,
  Line as ThreeLine,
  LineBasicMaterial,
  type BufferAttribute,
  type Object3D,
  Vector3,
} from 'three'
import Node from './components/Node'
import { useDockerStore, type Container } from './store/useDockerStore'

type Body = {
  id: string
  position: Vector3
  velocity: Vector3
  targetScale: number
  object?: Object3D
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

type ConnectionPair = {
  from: string
  to: string
  strength: number
}

function buildConnectionPairs(containers: Container[]): ConnectionPair[] {
  const byNetwork = new Map<string, string[]>()

  for (const container of containers) {
    const networks = container.networks ?? []
    for (const network of networks) {
      if (network === 'host' || network === 'none') {
        continue
      }
      const ids = byNetwork.get(network)
      if (!ids) {
        byNetwork.set(network, [container.id])
      } else {
        ids.push(container.id)
      }
    }
  }

  const dedup = new Map<string, ConnectionPair>()
  for (const ids of byNetwork.values()) {
    ids.sort()
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const key = `${ids[i]}::${ids[j]}`
        const existing = dedup.get(key)
        if (existing) {
          existing.strength += 1
        } else {
          dedup.set(key, { from: ids[i], to: ids[j], strength: 1 })
        }
      }
    }
  }

  return Array.from(dedup.values())
}

function DynamicConnectionLine({
  pair,
  bodiesRef,
  selectedContainerId,
}: {
  pair: ConnectionPair
  bodiesRef: MutableRefObject<Map<string, Body>>
  selectedContainerId: string | null
}) {
  const lineRef = useRef<ThreeLine>(null)
  const baseOpacity = useMemo(() => clamp(0.12 + pair.strength * 0.1, 0.12, 0.4), [pair.strength])
  const positions = useMemo(() => new Float32Array(6), [])
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return g
  }, [positions])
  const material = useMemo(
    () =>
      new LineBasicMaterial({
        color: '#74d9ff',
        transparent: true,
        opacity: baseOpacity,
      }),
    [baseOpacity],
  )

  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  useFrame(() => {
    const fromBody = bodiesRef.current.get(pair.from)
    const toBody = bodiesRef.current.get(pair.to)

    if (!fromBody || !toBody || !lineRef.current) {
      return
    }

    positions[0] = fromBody.position.x
    positions[1] = fromBody.position.y
    positions[2] = fromBody.position.z
    positions[3] = toBody.position.x
    positions[4] = toBody.position.y
    positions[5] = toBody.position.z

    const attr = geometry.getAttribute('position') as BufferAttribute
    attr.needsUpdate = true

    const focused = !selectedContainerId || pair.from === selectedContainerId || pair.to === selectedContainerId
    material.opacity = focused ? baseOpacity : 0.03
  })

  const line = useMemo(() => new ThreeLine(geometry, material), [geometry, material])
  return <primitive ref={lineRef} object={line} frustumCulled={false} />
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
  const bodiesRef = useRef<Map<string, Body>>(new Map())
  const connections = useMemo(() => buildConnectionPairs(containers), [containers])

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
        position: randomSpawn(12 + Math.random() * 4),
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

    const repulsion = 16
    const centerPull = 0.38
    const maxSpeed = 4.5

    for (let i = 0; i < bodies.length; i += 1) {
      const a = bodies[i]

      for (let j = i + 1; j < bodies.length; j += 1) {
        const b = bodies[j]
        TMP.copy(a.position).sub(b.position)
        let dist = TMP.length()
        if (dist < 0.0001) {
          TMP.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
          dist = TMP.length()
        }

        const distSq = clamp(dist * dist, 0.25, 999999)
        const force = repulsion / distSq

        TMP.normalize().multiplyScalar(force * delta)
        a.velocity.add(TMP)
        b.velocity.sub(TMP)

        const minDistance = (a.targetScale + b.targetScale) * 1.7
        if (dist < minDistance) {
          const overlapPush = (minDistance - dist) * 1.2 * delta
          TMP.normalize().multiplyScalar(overlapPush)
          a.velocity.add(TMP)
          b.velocity.sub(TMP)
        }
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
      if (body.object) {
        body.object.position.lerp(body.position, Math.min(1, delta * 10))
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
            isSelected={selectedContainerId === container.id}
            isDimmed={selectedContainerId !== null && selectedContainerId !== container.id}
            onSelect={onSelectContainer}
            onReady={(id, object) => {
              const current = bodiesRef.current.get(id)
              if (!current) {
                return
              }
              current.object = object
              object.position.copy(current.position)
            }}
          />
        )
      }),
    [containers, onSelectContainer, selectedContainerId],
  )

  const links = useMemo(
    () =>
      connections.map((pair) => (
        <group key={`${pair.from}-${pair.to}`}>
          <DynamicConnectionLine pair={pair} bodiesRef={bodiesRef} selectedContainerId={selectedContainerId} />
        </group>
      )),
    [connections, selectedContainerId],
  )

  return (
    <>
      {links}
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
      camera={{ position: [0, 4, 22], fov: 50 }}
      onPointerMissed={() => setSelectedContainerId(null)}
    >
      <color attach="background" args={['#05070d']} />
      <fog attach="fog" args={['#05070d', 16, 34]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[8, 10, 5]} intensity={0.95} color="#b1f5ff" />
      <pointLight position={[-10, -4, -5]} intensity={0.3} color="#53e0ff" />
      <Stars radius={80} depth={45} count={260} factor={1.4} saturation={0} fade speed={0.2} />
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
      <OrbitControls enableDamping dampingFactor={0.08} maxDistance={55} minDistance={8} />
    </Canvas>
  )
}
