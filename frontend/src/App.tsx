import './App.css'
import { useWebSocket } from './hooks/useWebSocket'
import { useDockerStore } from './store/useDockerStore'

function App() {
  useWebSocket()

  const state = useDockerStore((s) => s.state)
  const isConnected = useDockerStore((s) => s.isConnected)
  const error = useDockerStore((s) => s.error)
  const lastMessageAt = useDockerStore((s) => s.lastMessageAt)

  const containerCount = state?.containers?.length ?? 0
  const health = state?.health?.status ?? 'unknown'
  const healthMsg = state?.health?.message ?? '-'
  const snapshotTs = state?.timestamp ? new Date(state.timestamp).toLocaleTimeString() : '-'
  const lastMessageTs = lastMessageAt ? new Date(lastMessageAt).toLocaleTimeString() : '-'

  return (
    <main className="app">
      <h1>Docker Hologram - Phase 3</h1>
      <p className="subtitle">WebSocket bridge wired to Zustand store</p>

      <section className="grid">
        <article className="card">
          <h2>Socket</h2>
          <p>Status: {isConnected ? 'connected' : 'disconnected'}</p>
          <p>Error: {error ?? '-'}</p>
          <p>Last message: {lastMessageTs}</p>
        </article>

        <article className="card">
          <h2>Backend Snapshot</h2>
          <p>Snapshot time: {snapshotTs}</p>
          <p>Health: {health}</p>
          <p>Health message: {healthMsg}</p>
          <p>Containers: {containerCount}</p>
        </article>
      </section>

      <section className="card">
        <h2>Raw JSON</h2>
        <pre>{JSON.stringify(state, null, 2)}</pre>
      </section>
    </main>
  )
}

export default App
