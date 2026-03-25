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
  selectedContainerId: string | null
  setState: (nextState: SystemState) => void
  setConnected: (connected: boolean) => void
  setError: (error: string | null) => void
  setSelectedContainerId: (id: string | null) => void
}

export const useDockerStore = create<DockerStore>((set) => ({
  state: null,
  isConnected: false,
  error: null,
  lastMessageAt: null,
  selectedContainerId: null,
  setState: (nextState) =>
    set((current) => {
      const containers = nextState.containers ?? []
      const selectedStillExists =
        current.selectedContainerId === null ||
        containers.some((container) => container.id === current.selectedContainerId)

      return {
        state: {
          ...nextState,
          containers,
        },
        lastMessageAt: Date.now(),
        error: null,
        selectedContainerId: selectedStillExists ? current.selectedContainerId : null,
      }
    }),
  setConnected: (connected) => set({ isConnected: connected }),
  setError: (error) => set({ error }),
  setSelectedContainerId: (id) => set({ selectedContainerId: id }),
}))
