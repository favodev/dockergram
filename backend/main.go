package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	dockercore "docker-hologram/internal/docker"
	wsbridge "docker-hologram/internal/ws"
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

	hub := wsbridge.NewHub()
	wsServer := wsbridge.NewServer(hub, store)
	mux := http.NewServeMux()
	wsServer.RegisterRoutes(mux)

	httpServer := &http.Server{
		Addr:    ":8080",
		Handler: mux,
	}

	go wsbridge.StartBroadcaster(ctx, hub, store, 500*time.Millisecond)

	go func() {
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("http server error: %v", err)
			stop()
		}
	}()

	printTicker := time.NewTicker(3 * time.Second)
	defer printTicker.Stop()

	log.Printf("phase 2 server started on :8080 (ws endpoint: /ws)")
	log.Printf("press Ctrl+C to stop")

	for {
		select {
		case <-ctx.Done():
			log.Printf("shutdown requested")
			shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancelShutdown()
			if err := httpServer.Shutdown(shutdownCtx); err != nil {
				log.Printf("http shutdown error: %v", err)
			}
			return
		case <-printTicker.C:
			snapshot := store.Get()
			fmt.Printf("[%d] health=%s msg=%s containers=%d wsClients=%d\n", snapshot.Timestamp, snapshot.Health.Status, snapshot.Health.Message, len(snapshot.Containers), hub.Count())
		}
	}
}
