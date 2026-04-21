package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	dockercore "docker-hologram/internal/docker"
	wsbridge "docker-hologram/internal/ws"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	bindAddr := "127.0.0.1:8080"
	collectEvery := 500 * time.Millisecond
	broadcastEvery := collectEvery
	actionToken := strings.TrimSpace(os.Getenv("DOCKERGRAM_ACTION_TOKEN"))
	allowedOrigins := map[string]struct{}{
		"http://localhost:5173": {},
		"http://127.0.0.1:5173": {},
		"http://localhost:8080": {},
		"http://127.0.0.1:8080": {},
	}
	actionRateLimit := 20
	actionRateWindow := 10 * time.Second
	trustProxyHeaders, _ := strconv.ParseBool(strings.TrimSpace(os.Getenv("DOCKERGRAM_TRUST_PROXY_HEADERS")))

	if actionToken == "" {
		log.Printf("warning: DOCKERGRAM_ACTION_TOKEN not set, container actions are disabled")
	}
	if trustProxyHeaders {
		log.Printf("warning: DOCKERGRAM_TRUST_PROXY_HEADERS enabled, ensure requests pass through a trusted proxy")
	}

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
	collectorDone := cli.StartStateCollectorAsync(ctx, collectEvery, store)

	hub := wsbridge.NewHub()
	wsServer := wsbridge.NewServer(hub, store, cli, wsbridge.ServerOptions{
		ActionToken:       actionToken,
		AllowedOrigins:    allowedOrigins,
		ActionRateLimit:   actionRateLimit,
		ActionWindow:      actionRateWindow,
		TrustProxyHeaders: trustProxyHeaders,
	})
	mux := http.NewServeMux()
	wsServer.RegisterRoutes(mux)

	httpServer := &http.Server{
		Addr:              bindAddr,
		Handler:           mux,
		ReadHeaderTimeout: 2 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go wsbridge.StartBroadcaster(ctx, hub, store, broadcastEvery)

	go func() {
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("http server error: %v", err)
			stop()
		}
	}()

	printTicker := time.NewTicker(3 * time.Second)
	defer printTicker.Stop()

	log.Printf("server started on %s (ws endpoint: /ws)", bindAddr)
	log.Printf("press Ctrl+C to stop")

	for {
		select {
		case <-ctx.Done():
			log.Printf("shutdown requested")
			shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 5*time.Second)
			if err := httpServer.Shutdown(shutdownCtx); err != nil {
				log.Printf("http shutdown error: %v", err)
			}
			cancelShutdown()

			select {
			case <-collectorDone:
				log.Printf("state collector stopped")
			case <-time.After(2 * time.Second):
				log.Printf("state collector stop timeout")
			}
			return
		case <-printTicker.C:
			snapshot := store.Get()
			fmt.Printf("[%d] health=%s msg=%s containers=%d wsClients=%d\n", snapshot.Timestamp, snapshot.Health.Status, snapshot.Health.Message, len(snapshot.Containers), hub.Count())
		}
	}
}
