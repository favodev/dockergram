package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	dockercore "docker-hologram/internal/docker"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cli, err := dockercore.NewClient()
	if err != nil {
		log.Fatalf("docker client init failed: %v", err)
	}
	defer func() {
		if err := cli.Close(); err != nil {
			log.Printf("docker client close error: %v", err)
		}
	}()

	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	initialHealth := cli.Ping(pingCtx)
	cancel()

	if initialHealth.Status == "ok" {
		log.Printf("docker health: ok")
	} else {
		log.Printf("docker health: error (%s)", initialHealth.Message)
	}

	store := dockercore.NewStateStore()
	go cli.StartStateCollector(ctx, 500*time.Millisecond, store)

	printTicker := time.NewTicker(3 * time.Second)
	defer printTicker.Stop()

	log.Printf("phase 1 runner started. Press Ctrl+C to stop.")

	for {
		select {
		case <-ctx.Done():
			log.Printf("shutdown requested")
			return
		case <-printTicker.C:
			snapshot := store.Get()
			fmt.Printf("[%d] health=%s msg=%s containers=%d\n", snapshot.Timestamp, snapshot.Health.Status, snapshot.Health.Message, len(snapshot.Containers))
		}
	}
}
