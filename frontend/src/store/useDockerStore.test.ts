import { beforeEach, describe, expect, it } from 'vitest'
import { useDockerStore, type SystemState } from './useDockerStore'

function makeState(containerIDs: string[]): SystemState {
  return {
    timestamp: Date.now(),
    health: {
      status: 'ok',
      timestamp: Date.now(),
    },
    containers: containerIDs.map((id, idx) => ({
      id,
      name: `c-${idx}`,
      image: 'img',
      networks: ['default'],
      state: 'running',
      stats: {
        cpuPercent: 0,
        memUsage: 0,
        memLimit: 0,
        memPercent: 0,
        netRxBytes: 0,
        netTxBytes: 0,
      },
    })),
  }
}

describe('useDockerStore', () => {
  beforeEach(() => {
    useDockerStore.setState({
      state: null,
      isConnected: false,
      error: null,
      lastMessageAt: null,
      selectedContainerId: null,
    })
  })

  it('keeps selected container when it still exists in next state', () => {
    const store = useDockerStore.getState()
    store.setSelectedContainerId('a')
    store.setState(makeState(['a', 'b']))

    expect(useDockerStore.getState().selectedContainerId).toBe('a')
  })

  it('clears selected container when it is missing in next state', () => {
    const store = useDockerStore.getState()
    store.setSelectedContainerId('missing')
    store.setState(makeState(['a', 'b']))

    expect(useDockerStore.getState().selectedContainerId).toBeNull()
  })
})
