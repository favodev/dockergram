import { useEffect } from 'react'
import ReconnectingWebSocket from 'reconnecting-websocket'
import { useDockerStore, type SystemState } from '../store/useDockerStore'

const WS_URL = 'ws://localhost:8080/ws'

export function useWebSocket(): void {
  const setState = useDockerStore((s) => s.setState)
  const setConnected = useDockerStore((s) => s.setConnected)
  const setError = useDockerStore((s) => s.setError)

  useEffect(() => {
    const ws = new ReconnectingWebSocket(WS_URL, [], {
      maxRetries: Infinity,
      minReconnectionDelay: 500,
      maxReconnectionDelay: 3000,
      reconnectionDelayGrowFactor: 1.5,
    })

    ws.addEventListener('open', () => {
      setConnected(true)
      setError(null)
      console.info('[ws] connected:', WS_URL)
    })

    ws.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as SystemState
        setState(payload)
      } catch (error) {
        setError('invalid_json')
        console.error('[ws] invalid message payload', error)
      }
    })

    ws.addEventListener('close', () => {
      setConnected(false)
      console.warn('[ws] disconnected')
    })

    ws.addEventListener('error', () => {
      setError('socket_error')
    })

    return () => {
      ws.close()
    }
  }, [setConnected, setError, setState])
}
