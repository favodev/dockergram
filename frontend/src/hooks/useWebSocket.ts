import { useEffect } from 'react'
import ReconnectingWebSocket from 'reconnecting-websocket'
import { useDockerStore, type ContainerStats, type SystemState } from '../store/useDockerStore'
import { WS_URL } from '../config/runtime'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

const EMPTY_STATS: ContainerStats = {
  cpuPercent: 0,
  memUsage: 0,
  memLimit: 0,
  memPercent: 0,
  netRxBytes: 0,
  netTxBytes: 0,
}

function normalizeStats(value: unknown): ContainerStats {
  if (!isRecord(value)) {
    return EMPTY_STATS
  }

  return {
    cpuPercent: isFiniteNumber(value.cpuPercent) ? value.cpuPercent : 0,
    memUsage: isFiniteNumber(value.memUsage) ? value.memUsage : 0,
    memLimit: isFiniteNumber(value.memLimit) ? value.memLimit : 0,
    memPercent: isFiniteNumber(value.memPercent) ? value.memPercent : 0,
    netRxBytes: isFiniteNumber(value.netRxBytes) ? value.netRxBytes : 0,
    netTxBytes: isFiniteNumber(value.netTxBytes) ? value.netTxBytes : 0,
  }
}

function parseSystemState(value: unknown): SystemState | null {
  if (!isRecord(value)) {
    return null
  }

  if (!isFiniteNumber(value.timestamp) || !isRecord(value.health) || !Array.isArray(value.containers)) {
    return null
  }

  if (typeof value.health.status !== 'string' || !isFiniteNumber(value.health.timestamp)) {
    return null
  }

  const containers = value.containers.map((item) => {
    if (!isRecord(item)) {
      return null
    }
    if (typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.image !== 'string' || typeof item.state !== 'string') {
      return null
    }

    const networks = Array.isArray(item.networks)
      ? item.networks.filter((network): network is string => typeof network === 'string')
      : []

    return {
      id: item.id,
      name: item.name,
      image: item.image,
      networks,
      state: item.state,
      stats: normalizeStats(item.stats),
    }
  })

  if (containers.some((container) => container === null)) {
    return null
  }

  return {
    timestamp: value.timestamp,
    health: {
      status: value.health.status,
      message: typeof value.health.message === 'string' ? value.health.message : undefined,
      timestamp: value.health.timestamp,
    },
    containers: containers as SystemState['containers'],
  }
}

export function useWebSocket(): void {
  const setState = useDockerStore((s) => s.setState)
  const setConnected = useDockerStore((s) => s.setConnected)
  const setError = useDockerStore((s) => s.setError)

  useEffect(() => {
    const ws = new ReconnectingWebSocket(WS_URL, [], {
      maxRetries: 120,
      minReconnectionDelay: 1000,
      maxReconnectionDelay: 10000,
      reconnectionDelayGrowFactor: 1.5,
    })

    ws.addEventListener('open', () => {
      setConnected(true)
      setError(null)
      console.info('[ws] connected:', WS_URL)
    })

    ws.addEventListener('message', (event) => {
      try {
        const decoded = JSON.parse(String(event.data)) as unknown
        const payload = parseSystemState(decoded)
        if (!payload) {
          setError('invalid_state_shape')
          console.error('[ws] invalid state payload shape')
          return
        }

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
