import './App.css'
import { useState } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useDockerStore, type Container } from './store/useDockerStore'
import Scene from './Scene'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'
type ContainerAction = 'restart' | 'stop' | 'kill'

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

  const isConnected = useDockerStore((s) => s.isConnected)
  const error = useDockerStore((s) => s.error)
  const health = useDockerStore((s) => s.state?.health?.status ?? 'unknown')
  const healthMsg = useDockerStore((s) => s.state?.health?.message ?? '-')
  const containers = useDockerStore((s) => s.state?.containers ?? [])
  const containerCount = containers.length
  const selectedContainerId = useDockerStore((s) => s.selectedContainerId)

  const selected = findSelected(containers, selectedContainerId)

  const runAction = async (action: ContainerAction) => {
    if (!selected || pendingAction) {
      return
    }

    setPendingAction(action)
    setActionStatus('')
    try {
      const response = await fetch(`${API_BASE_URL}/api/container/${selected.id}/${action}`, {
        method: 'POST',
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
      <Scene />

      <aside className="hud" aria-live="polite">
        <h1>Docker Hologram</h1>
        <p>Fase 4 · Forjando el Holograma</p>
        <p>Socket: {isConnected ? 'connected' : 'disconnected'}</p>
        <p>Backend health: {health}</p>
        <p>Health message: {healthMsg}</p>
        <p>Containers: {containerCount}</p>
        <p>Error: {error ?? '-'}</p>
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
              <button type="button" disabled={pendingAction !== null} onClick={() => runAction('restart')}>
                Restart
              </button>
              <button type="button" disabled={pendingAction !== null} onClick={() => runAction('stop')}>
                Stop
              </button>
              <button type="button" disabled={pendingAction !== null} onClick={() => runAction('kill')}>
                Kill
              </button>
            </div>
            <p className="action-status">{pendingAction ? `Running ${pendingAction}...` : actionStatus || 'Ready'}</p>
          </>
        )}
      </aside>
    </main>
  )
}

export default App
