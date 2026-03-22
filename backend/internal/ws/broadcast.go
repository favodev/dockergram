package ws

import (
	"context"
	"time"

	dockercore "docker-hologram/internal/docker"
)

// StartBroadcaster pushes the latest state snapshot to all WS clients on an interval.
func StartBroadcaster(ctx context.Context, hub *Hub, store *dockercore.StateStore, every time.Duration) {
	if hub == nil || store == nil {
		return
	}
	if every <= 0 {
		every = 500 * time.Millisecond
	}

	ticker := time.NewTicker(every)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			hub.BroadcastJSON(store.Get())
		}
	}
}
