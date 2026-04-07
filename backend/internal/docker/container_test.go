package docker

import (
	"math"
	"testing"
	"time"

	typescontainer "github.com/docker/docker/api/types/container"
)

func almostEqual(a float64, b float64, tolerance float64) bool {
	return math.Abs(a-b) <= tolerance
}

func TestCalculateCPUPercentLinuxStyle(t *testing.T) {
	stats := typescontainer.StatsResponse{
		CPUStats: typescontainer.CPUStats{
			SystemUsage: 2000,
			OnlineCPUs:  2,
			CPUUsage: typescontainer.CPUUsage{
				TotalUsage: 300,
			},
		},
		PreCPUStats: typescontainer.CPUStats{
			SystemUsage: 1000,
			CPUUsage: typescontainer.CPUUsage{
				TotalUsage: 100,
			},
		},
	}

	got := calculateCPUPercent(stats)
	want := 40.0
	if !almostEqual(got, want, 0.00001) {
		t.Fatalf("unexpected cpu percent: got=%f want=%f", got, want)
	}
}

func TestCalculateCPUPercentWindowsFallback(t *testing.T) {
	now := time.Now().UTC()
	stats := typescontainer.StatsResponse{
		Read:     now,
		PreRead:  now.Add(-time.Second),
		NumProcs: 4,
		CPUStats: typescontainer.CPUStats{
			CPUUsage: typescontainer.CPUUsage{
				TotalUsage: 10_000_000,
			},
		},
		PreCPUStats: typescontainer.CPUStats{
			CPUUsage: typescontainer.CPUUsage{
				TotalUsage: 0,
			},
		},
	}

	got := calculateCPUPercent(stats)
	want := 25.0
	if !almostEqual(got, want, 0.00001) {
		t.Fatalf("unexpected windows cpu percent: got=%f want=%f", got, want)
	}
}

func TestCalculateCPUPercentReturnsZeroWhenNoDeltas(t *testing.T) {
	stats := typescontainer.StatsResponse{}
	if got := calculateCPUPercent(stats); got != 0 {
		t.Fatalf("expected zero cpu percent, got=%f", got)
	}
}
