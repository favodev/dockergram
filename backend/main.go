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

func envOrDefault(key, fallback string) string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	return v
}

func parseDurationEnv(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}

	parsed, err := time.ParseDuration(raw)
	if err != nil || parsed <= 0 {
		return fallback
	}

	return parsed
}

func parseIntEnv(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return fallback
	}

	return parsed
}

func parseAllowedOrigins(raw string) map[string]struct{} {
	out := make(map[string]struct{})
	for _, part := range strings.Split(raw, ",") {
		origin := strings.TrimSpace(part)
		if origin == "" {
			continue
		}
		out[origin] = struct{}{}
	}
	return out
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	bindAddr := envOrDefault("DOCKERGRAM_BIND", "127.0.0.1:8080")
	collectEvery := parseDurationEnv("DOCKERGRAM_COLLECT_INTERVAL", 1*time.Second)
	broadcastEvery := parseDurationEnv("DOCKERGRAM_BROADCAST_INTERVAL", collectEvery)
	actionToken := envOrDefault("DOCKERGRAM_ACTION_TOKEN", "dockergram-local-dev-token")
	allowedOrigins := parseAllowedOrigins(envOrDefault(
		"DOCKERGRAM_ALLOWED_ORIGINS",
		"http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080",
	))
	actionRateLimit := parseIntEnv("DOCKERGRAM_ACTION_RATE_LIMIT", 20)
	actionRateWindow := parseDurationEnv("DOCKERGRAM_ACTION_RATE_WINDOW", 10*time.Second)

	if strings.TrimSpace(os.Getenv("DOCKERGRAM_ACTION_TOKEN")) == "" {
		log.Printf("warning: DOCKERGRAM_ACTION_TOKEN not set, using development token")
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
	go cli.StartStateCollector(ctx, collectEvery, store)

	hub := wsbridge.NewHub()
	wsServer := wsbridge.NewServer(hub, store, cli, wsbridge.ServerOptions{
		ActionToken:     actionToken,
		AllowedOrigins:  allowedOrigins,
		ActionRateLimit: actionRateLimit,
		ActionWindow:    actionRateWindow,
	})
	mux := http.NewServeMux()
	wsServer.RegisterRoutes(mux)

	httpServer := &http.Server{
		Addr:    bindAddr,
		Handler: mux,
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
