package docker

import "time"

// HealthSignal is a lightweight status payload the frontend can consume.
type HealthSignal struct {
	Status    string `json:"status"`
	Message   string `json:"message,omitempty"`
	Timestamp int64  `json:"timestamp"`
}

// ContainerStats holds runtime metrics for one container.
type ContainerStats struct {
	CPUPercent float64 `json:"cpuPercent"`
	MemUsage   uint64  `json:"memUsage"`
	MemLimit   uint64  `json:"memLimit"`
	MemPercent float64 `json:"memPercent"`
	NetRXBytes uint64  `json:"netRxBytes"`
	NetTXBytes uint64  `json:"netTxBytes"`
}

// Container is the normalized container shape the frontend receives.
type Container struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	Image    string         `json:"image"`
	Networks []string       `json:"networks"`
	State    string         `json:"state"`
	Stats    ContainerStats `json:"stats"`
}

// SystemState is the periodic snapshot sent to the frontend.
type SystemState struct {
	Timestamp  int64        `json:"timestamp"`
	Containers []Container  `json:"containers"`
	Health     HealthSignal `json:"health"`
}

// NewTimestampMillis returns current UTC timestamp in milliseconds.
func NewTimestampMillis() int64 {
	return time.Now().UTC().UnixMilli()
}
