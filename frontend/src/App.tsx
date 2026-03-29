import './App.css'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useDockerStore, type Container } from './store/useDockerStore'

const API_BASE_URL = 'http://localhost:8080'
const ACTION_TOKEN = 'dockergram-local-dev-token'
const EMPTY_CONTAINERS: Container[] = []
type ContainerAction = 'start' | 'restart' | 'stop' | 'kill'
const Scene = lazy(() => import('./Scene'))

type MetricHistory = {
  cpu: number[]
  mem: number[]
  net: number[]
}

function pushHistory(values: number[], nextValue: number, max = 42): number[] {
  const out = [...values, nextValue]
  if (out.length > max) {
    out.splice(0, out.length - max)
  }
  return out
}

function MiniChart({ values, color }: { values: number[]; color: string }) {
  const points = useMemo(() => {
    if (values.length <= 1) {
      return '0,36 100,36'
    }
    const max = Math.max(1, ...values)
    return values
      .map((value, idx) => {
        const x = (idx / (values.length - 1)) * 100
        const y = 36 - (value / max) * 30
        return `${x},${y}`
      })
      .join(' ')
  }, [values])

  return (
    <svg className="metric-chart" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`
}

function findSelected(containers: Container[], id: string | null): Container | null {
  if (!id) {
    return null
  }
  return containers.find((container) => container.id === id) ?? null
}

function App() {
  useWebSocket()
  const [pendingAction, setPendingAction] = useState<ContainerAction | null>(null)
  const [actionStatus, setActionStatus] = useState<string>('')
  const [history, setHistory] = useState<MetricHistory>({ cpu: [], mem: [], net: [] })

  const isConnected = useDockerStore((s) => s.isConnected)
  const error = useDockerStore((s) => s.error)
  const health = useDockerStore((s) => s.state?.health?.status ?? 'unknown')
  const healthMsg = useDockerStore((s) => s.state?.health?.message ?? '-')
  const containers = useDockerStore((s) => s.state?.containers ?? EMPTY_CONTAINERS)
  const containerCount = containers.length
  const selectedContainerId = useDockerStore((s) => s.selectedContainerId)
  const setSelectedContainerId = useDockerStore((s) => s.setSelectedContainerId)

  const selected = findSelected(containers, selectedContainerId)
  const healthTone = health === 'ok' ? 'ok' : 'warn'

  const runningCount = useMemo(
    () => containers.filter((container) => container.state === 'running').length,
    [containers],
  )
  const stoppedCount = Math.max(0, containerCount - runningCount)
  const offContainers = useMemo(
    () => containers.filter((container) => !['running', 'paused'].includes(container.state)),
    [containers],
  )
  const orderedContainers = useMemo(() => {
    const sorted = [...containers]
    sorted.sort((a, b) => {
      const aRunning = ['running', 'paused'].includes(a.state) ? 1 : 0
      const bRunning = ['running', 'paused'].includes(b.state) ? 1 : 0
      if (aRunning !== bRunning) {
        return bRunning - aRunning
      }
      return (a.name || a.id).localeCompare(b.name || b.id)
    })
    return sorted
  }, [containers])

  const totals = useMemo(() => {
    const cpu = containers.reduce((acc, container) => acc + (container.stats?.cpuPercent ?? 0), 0)
    const memUsed = containers.reduce((acc, container) => acc + (container.stats?.memUsage ?? 0), 0)
    const memLimit = containers.reduce((acc, container) => acc + (container.stats?.memLimit ?? 0), 0)
    const net = containers.reduce(
      (acc, container) => acc + (container.stats?.netRxBytes ?? 0) + (container.stats?.netTxBytes ?? 0),
      0,
    )
    const memPercent = memLimit > 0 ? (memUsed / memLimit) * 100 : 0
    return { cpu, memPercent, net }
  }, [containers])

  useEffect(() => {
    setHistory((current) => ({
      cpu: pushHistory(current.cpu, totals.cpu),
      mem: pushHistory(current.mem, totals.memPercent),
      net: pushHistory(current.net, totals.net),
    }))
  }, [totals.cpu, totals.memPercent, totals.net])

  useEffect(() => {
    if (selectedContainerId || orderedContainers.length === 0) {
      return
    }
    setSelectedContainerId(orderedContainers[0].id)
  }, [orderedContainers, selectedContainerId, setSelectedContainerId])

  const runAction = async (action: ContainerAction, targetContainerId?: string) => {
    if (pendingAction) {
      return
    }

    const targetId = targetContainerId ?? selected?.id
    if (!targetId) {
      return
    }

    setPendingAction(action)
    setActionStatus('')
    try {
      const response = await fetch(`${API_BASE_URL}/api/container/${targetId}/${action}`, {
        method: 'POST',
        headers: {
          'X-Action-Token': ACTION_TOKEN,
        },
      })

      const payload = (await response.json()) as { status?: string; message?: string }
      if (!response.ok || payload.status !== 'ok') {
        throw new Error(payload.message ?? `request_failed_${response.status}`)
      }

      setActionStatus(`${action.toUpperCase()} OK`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown_error'
      setActionStatus(`${action.toUpperCase()} ERROR: ${msg}`)
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <main className="app-root">
      <Suspense fallback={<div className="scene-loading">Loading 3D scene...</div>}>
        <Scene />
      </Suspense>

      <header className="topbar" aria-live="polite">
        <div className="brand">
          <span className="dot" />
          <strong>DOCKERGRAM CORE</strong>
        </div>
        <div className="badges">
          <span className={`badge ${isConnected ? 'ok' : 'warn'}`}>WS {isConnected ? 'ONLINE' : 'OFFLINE'}</span>
          <span className={`badge ${healthTone}`}>HEALTH {health.toUpperCase()}</span>
          <span className="badge">NODES {containerCount}</span>
          <span className="badge ok">RUN {runningCount}</span>
          <span className="badge warn">OFF {stoppedCount}</span>
        </div>
      </header>

      <aside className="hud" aria-live="polite">
        <h1>Docker Hologram</h1>
        <p>Neural Infrastructure View</p>
        <p>Socket: {isConnected ? 'connected' : 'disconnected'}</p>
        <p>Backend health: {health}</p>
        <p>Health message: {healthMsg}</p>
        <p>Containers: {containerCount}</p>
        <p>Running: {runningCount} | Off: {stoppedCount}</p>
        <p>Error: {error ?? '-'}</p>

        <div className="container-list">
          <label>Container focus</label>
          <ul>
            {orderedContainers.map((container) => {
              const name = container.name || container.id.slice(0, 12)
              const isRunning = ['running', 'paused'].includes(container.state)
              const isActive = selectedContainerId === container.id
              return (
                <li key={container.id}>
                  <button
                    type="button"
                    className={`focus-row ${isActive ? 'active' : ''}`}
                    onClick={() => setSelectedContainerId(container.id)}
                  >
                    <span>{name}</span>
                    <strong className={isRunning ? 'state-run' : 'state-off'}>{isRunning ? 'RUN' : 'OFF'}</strong>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="stopped-list">
          <label>OFF containers</label>
          {offContainers.length === 0 ? (
            <p className="stopped-empty">No hay contenedores apagados.</p>
          ) : (
            <ul>
              {offContainers.map((container) => (
                <li key={container.id}>
                  <span>{container.name || container.id.slice(0, 12)}</span>
                  <button
                    type="button"
                    disabled={pendingAction !== null}
                    onClick={() => runAction('start', container.id)}
                  >
                    Start
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="metric-panel">
          <div>
            <label>Total CPU</label>
            <strong>{totals.cpu.toFixed(1)}%</strong>
            <MiniChart values={history.cpu} color="#4ff4db" />
          </div>
          <div>
            <label>Memory Load</label>
            <strong>{totals.memPercent.toFixed(1)}%</strong>
            <MiniChart values={history.mem} color="#7fc5ff" />
          </div>
          <div>
            <label>Network Traffic</label>
            <strong>{formatBytes(totals.net)}</strong>
            <MiniChart values={history.net} color="#ffa1e8" />
          </div>
        </div>
      </aside>

      <aside className="detail-hud" aria-live="polite">
        <h2>Container Detail</h2>

        {!selected ? (
          <p>Haz click en un nodo para ver su detalle.</p>
        ) : (
          <>
            <p>Name: {selected.name || '-'}</p>
            <p>ID: {selected.id.slice(0, 12)}</p>
            <p>Image: {selected.image || '-'}</p>
            <p>State: {selected.state || '-'}</p>
            <p>CPU: {(selected.stats?.cpuPercent ?? 0).toFixed(2)}%</p>
            <p>Memory: {formatBytes(selected.stats?.memUsage ?? 0)} / {formatBytes(selected.stats?.memLimit ?? 0)}</p>
            <p>RX/TX: {formatBytes(selected.stats?.netRxBytes ?? 0)} / {formatBytes(selected.stats?.netTxBytes ?? 0)}</p>
            <p>Networks: {selected.networks?.length ? selected.networks.join(', ') : '-'}</p>

            <div className="actions">
              <button
                type="button"
                disabled={pendingAction !== null || !['exited', 'created', 'dead'].includes(selected.state)}
                onClick={() => runAction('start')}
              >
                Start
              </button>
              <button type="button" disabled={pendingAction !== null} onClick={() => runAction('restart')}>
                Restart
              </button>
              <button
                type="button"
                disabled={pendingAction !== null || !['running', 'paused'].includes(selected.state)}
                onClick={() => runAction('stop')}
              >
                Stop
              </button>
              <button
                type="button"
                disabled={pendingAction !== null || !['running', 'paused'].includes(selected.state)}
                onClick={() => runAction('kill')}
              >
                Kill
              </button>
            </div>
            <p className="action-status">{pendingAction ? `Running ${pendingAction}...` : actionStatus || 'Ready'}</p>
          </>
        )}
      </aside>

      <footer className="footer-hint">
        <span>Drag to orbit</span>
        <span>Scroll to zoom</span>
        <span>Click node for detail</span>
      </footer>
    </main>
  )
}

export default App
