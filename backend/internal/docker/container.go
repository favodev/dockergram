package docker

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	typescontainer "github.com/docker/docker/api/types/container"
)

// StateStore keeps the latest snapshot in memory for WS broadcasting.
type StateStore struct {
	mu    sync.RWMutex
	state SystemState
}

func NewStateStore() *StateStore {
	return &StateStore{state: SystemState{Timestamp: NewTimestampMillis(), Health: HealthSignal{Status: "unknown", Timestamp: NewTimestampMillis()}}}
}

func (s *StateStore) Set(state SystemState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = state
}

func (s *StateStore) Get() SystemState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state
}

func (c *Client) ListContainers(ctx context.Context) ([]Container, error) {
	if c == nil || c.cli == nil {
		return nil, fmt.Errorf("docker client is nil")
	}

	items, err := c.cli.ContainerList(ctx, typescontainer.ListOptions{All: true})
	if err != nil {
		return nil, fmt.Errorf("list containers: %w", err)
	}

	out := make([]Container, 0, len(items))
	for _, item := range items {
		networks := make([]string, 0, len(item.NetworkSettings.Networks))
		for networkName := range item.NetworkSettings.Networks {
			networks = append(networks, networkName)
		}

		name := ""
		if len(item.Names) > 0 {
			name = strings.TrimPrefix(item.Names[0], "/")
		}

		out = append(out, Container{
			ID:       item.ID,
			Name:     name,
			Image:    item.Image,
			Networks: networks,
			State:    item.State,
		})
	}

	return out, nil
}

func (c *Client) FillContainerStats(ctx context.Context, containers []Container) []Container {
	if c == nil || c.cli == nil {
		return containers
	}

	for i := range containers {
		stats, err := c.getContainerStats(ctx, containers[i].ID)
		if err != nil {
			continue
		}
		containers[i].Stats = stats
	}

	return containers
}

func (c *Client) StartStateCollector(ctx context.Context, every time.Duration, store *StateStore) {
	if every <= 0 {
		every = 500 * time.Millisecond
	}

	ticker := time.NewTicker(every)
	defer ticker.Stop()

	collect := func() {
		health := c.Ping(ctx)
		state := SystemState{
			Timestamp: NewTimestampMillis(),
			Health:    health,
		}

		if health.Status == "ok" {
			containers, err := c.ListContainers(ctx)
			if err != nil {
				state.Health = HealthSignal{Status: "error", Message: "list_failed", Timestamp: NewTimestampMillis()}
			} else {
				state.Containers = c.FillContainerStats(ctx, containers)
			}
		}

		if store != nil {
			store.Set(state)
		}
	}

	collect()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			collect()
		}
	}
}

func (c *Client) getContainerStats(ctx context.Context, containerID string) (ContainerStats, error) {
	resp, err := c.cli.ContainerStats(ctx, containerID, false)
	if err != nil {
		return ContainerStats{}, err
	}
	defer resp.Body.Close()

	var payload typescontainer.StatsResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return ContainerStats{}, err
	}

	cpuPercent := calculateCPUPercent(payload)
	memUsage := payload.MemoryStats.Usage
	memLimit := payload.MemoryStats.Limit
	memPercent := 0.0
	if memLimit > 0 {
		memPercent = (float64(memUsage) / float64(memLimit)) * 100
	}

	var rx uint64
	var tx uint64
	for _, net := range payload.Networks {
		rx += net.RxBytes
		tx += net.TxBytes
	}

	return ContainerStats{
		CPUPercent: cpuPercent,
		MemUsage:   memUsage,
		MemLimit:   memLimit,
		MemPercent: memPercent,
		NetRXBytes: rx,
		NetTXBytes: tx,
	}, nil
}

func calculateCPUPercent(stats typescontainer.StatsResponse) float64 {
	cpuDelta := float64(stats.CPUStats.CPUUsage.TotalUsage - stats.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(stats.CPUStats.SystemUsage - stats.PreCPUStats.SystemUsage)
	if cpuDelta <= 0 || systemDelta <= 0 {
		return 0
	}

	onlineCPUs := float64(stats.CPUStats.OnlineCPUs)
	if onlineCPUs == 0 {
		onlineCPUs = float64(len(stats.CPUStats.CPUUsage.PercpuUsage))
		if onlineCPUs == 0 {
			onlineCPUs = 1
		}
	}

	return (cpuDelta / systemDelta) * onlineCPUs * 100
}
