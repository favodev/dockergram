import './App.css'
import { useWebSocket } from './hooks/useWebSocket'
import { useDockerStore } from './store/useDockerStore'
import Scene from './Scene'

function App() {
  useWebSocket()

  const isConnected = useDockerStore((s) => s.isConnected)
  const error = useDockerStore((s) => s.error)
  const health = useDockerStore((s) => s.state?.health?.status ?? 'unknown')
  const healthMsg = useDockerStore((s) => s.state?.health?.message ?? '-')
  const containerCount = useDockerStore((s) => s.state?.containers?.length ?? 0)

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
    </main>
  )
}

export default App
