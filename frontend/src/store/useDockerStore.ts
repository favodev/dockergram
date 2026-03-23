import { create } from 'zustand'

export type HealthSignal = {
  status: string
  message?: string
  timestamp: number
}

export type ContainerStats = {
  cpuPercent: number
  memUsage: number
  memLimit: number
  memPercent: number
  netRxBytes: number
  netTxBytes: number
}

export type Container = {
  id: string
  name: string
  image: string
  networks: string[]
  state: string
  stats: ContainerStats
}

export type SystemState = {
  timestamp: number
  containers: Container[]
  health: HealthSignal
}

type DockerStore = {
  state: SystemState | null
  isConnected: boolean
  error: string | null
  lastMessageAt: number | null
  setState: (nextState: SystemState) => void
  setConnected: (connected: boolean) => void
  setError: (error: string | null) => void
}

export const useDockerStore = create<DockerStore>((set) => ({
  state: null,
  isConnected: false,
  error: null,
  lastMessageAt: null,
  setState: (nextState) =>
    set({
      state: {
        ...nextState,
        containers: nextState.containers ?? [],
      },
      lastMessageAt: Date.now(),
      error: null,
    }),
  setConnected: (connected) => set({ isConnected: connected }),
  setError: (error) => set({ error }),
}))
