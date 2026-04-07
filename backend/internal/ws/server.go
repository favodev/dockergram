package ws

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"log"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"

	dockercore "docker-hologram/internal/docker"

	"github.com/gorilla/websocket"
)

const (
	wsReadLimit  int64 = 2048
	wsPongWait         = 45 * time.Second
	wsPingPeriod       = 30 * time.Second
	wsWriteWait        = 4 * time.Second
)

// DockerActions defines the action methods required by the HTTP action handlers.
type DockerActions interface {
	StartContainer(ctx context.Context, containerID string) error
	RestartContainer(ctx context.Context, containerID string) error
	StopContainer(ctx context.Context, containerID string) error
	KillContainer(ctx context.Context, containerID string) error
}

// ServerOptions configures security and limits for the WS/API layer.
type ServerOptions struct {
	ActionToken     string
	AllowedOrigins  map[string]struct{}
	ActionRateLimit int
	ActionWindow    time.Duration
}

type actionRateLimiter struct {
	mu      sync.Mutex
	max     int
	window  time.Duration
	buckets map[string]rateBucket

	cleanupInterval time.Duration
	nextCleanup     time.Time
}

type rateBucket struct {
	count int
	reset time.Time
}

func newActionRateLimiter(max int, window time.Duration) *actionRateLimiter {
	if max <= 0 {
		max = 20
	}
	if window <= 0 {
		window = 10 * time.Second
	}

	cleanupEvery := window * 2
	if cleanupEvery < 30*time.Second {
		cleanupEvery = 30 * time.Second
	}

	return &actionRateLimiter{
		max:             max,
		window:          window,
		buckets:         make(map[string]rateBucket),
		cleanupInterval: cleanupEvery,
		nextCleanup:     time.Now().Add(cleanupEvery),
	}
}

func (l *actionRateLimiter) cleanupExpiredLocked(now time.Time) {
	for key, bucket := range l.buckets {
		if !now.Before(bucket.reset) {
			delete(l.buckets, key)
		}
	}
}

func (l *actionRateLimiter) Allow(key string, now time.Time) bool {
	if l == nil {
		return true
	}

	if key == "" {
		key = "unknown"
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	if !now.Before(l.nextCleanup) {
		l.cleanupExpiredLocked(now)
		l.nextCleanup = now.Add(l.cleanupInterval)
	}

	b, ok := l.buckets[key]
	if !ok || now.After(b.reset) {
		l.buckets[key] = rateBucket{count: 1, reset: now.Add(l.window)}
		return true
	}

	if b.count >= l.max {
		return false
	}

	b.count += 1
	l.buckets[key] = b
	return true
}

func defaultServerOptions() ServerOptions {
	return ServerOptions{
		ActionToken:     "",
		AllowedOrigins:  map[string]struct{}{},
		ActionRateLimit: 20,
		ActionWindow:    10 * time.Second,
	}
}

// Server exposes websocket endpoints.
type Server struct {
	hub            *Hub
	store          *dockercore.StateStore
	docker         DockerActions
	actionToken    string
	allowedOrigins map[string]struct{}
	actionLimiter  *actionRateLimiter
	upg            websocket.Upgrader
}

func NewServer(hub *Hub, store *dockercore.StateStore, dockerClient DockerActions, opts ServerOptions) *Server {
	opts.ActionToken = strings.TrimSpace(opts.ActionToken)
	if opts.ActionRateLimit <= 0 {
		opts.ActionRateLimit = defaultServerOptions().ActionRateLimit
	}
	if opts.ActionWindow <= 0 {
		opts.ActionWindow = defaultServerOptions().ActionWindow
	}
	if opts.AllowedOrigins == nil {
		opts.AllowedOrigins = map[string]struct{}{}
	}

	return &Server{
		hub:            hub,
		store:          store,
		docker:         dockerClient,
		actionToken:    opts.ActionToken,
		allowedOrigins: opts.AllowedOrigins,
		actionLimiter:  newActionRateLimiter(opts.ActionRateLimit, opts.ActionWindow),
		upg: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				origin := strings.TrimSpace(r.Header.Get("Origin"))
				if origin == "" {
					return true
				}
				_, ok := opts.AllowedOrigins[origin]
				return ok
			},
		},
	}
}

func (s *Server) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/ws", s.handleWS)
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/api/container/{id}/{action}", s.handleContainerAction)
}

type actionResponse struct {
	Status  string `json:"status"`
	Action  string `json:"action,omitempty"`
	ID      string `json:"id,omitempty"`
	Message string `json:"message,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, body actionResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func applyCORS(w http.ResponseWriter, origin string) {
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Action-Token, Authorization")
}

func (s *Server) isOriginAllowed(origin string) bool {
	if origin == "" {
		return true
	}
	_, ok := s.allowedOrigins[origin]
	return ok
}

func extractClientIP(r *http.Request) string {
	xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For"))
	if xff != "" {
		parts := strings.Split(xff, ",")
		if len(parts) > 0 {
			candidate := strings.TrimSpace(parts[0])
			if addr, err := netip.ParseAddr(candidate); err == nil {
				return addr.String()
			}
		}
	}

	host := strings.TrimSpace(r.RemoteAddr)
	if host == "" {
		return "unknown"
	}

	if addrPort, err := netip.ParseAddrPort(host); err == nil {
		return addrPort.Addr().String()
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		return addr.String()
	}

	return host
}

func (s *Server) isActionAuthorized(r *http.Request) bool {
	provided := strings.TrimSpace(r.Header.Get("X-Action-Token"))
	if provided == "" {
		auth := strings.TrimSpace(r.Header.Get("Authorization"))
		if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
			provided = strings.TrimSpace(auth[7:])
		}
	}

	if provided == "" || s.actionToken == "" {
		return false
	}

	return subtle.ConstantTimeCompare([]byte(provided), []byte(s.actionToken)) == 1
}

func isValidContainerID(containerID string) bool {
	if containerID == "" || len(containerID) > 128 {
		return false
	}

	for i := 0; i < len(containerID); i += 1 {
		ch := containerID[i]
		isAlphaNum := (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')
		if isAlphaNum {
			continue
		}
		if i > 0 && (ch == '-' || ch == '_' || ch == '.') {
			continue
		}
		return false
	}

	return true
}

func (s *Server) handleContainerAction(w http.ResponseWriter, r *http.Request) {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if !s.isOriginAllowed(origin) {
		writeJSON(w, http.StatusForbidden, actionResponse{Status: "error", Message: "origin_not_allowed"})
		return
	}

	applyCORS(w, origin)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, actionResponse{Status: "error", Message: "method_not_allowed"})
		return
	}

	containerID := strings.TrimSpace(r.PathValue("id"))
	action := strings.ToLower(strings.TrimSpace(r.PathValue("action")))
	if containerID == "" {
		writeJSON(w, http.StatusBadRequest, actionResponse{Status: "error", Message: "missing_container_id"})
		return
	}
	if !isValidContainerID(containerID) {
		writeJSON(w, http.StatusBadRequest, actionResponse{Status: "error", Message: "invalid_container_id"})
		return
	}

	if !s.actionLimiter.Allow(extractClientIP(r), time.Now()) {
		writeJSON(w, http.StatusTooManyRequests, actionResponse{Status: "error", Message: "rate_limited"})
		return
	}

	if !s.isActionAuthorized(r) {
		writeJSON(w, http.StatusUnauthorized, actionResponse{Status: "error", Message: "unauthorized"})
		return
	}

	if s.docker == nil {
		writeJSON(w, http.StatusServiceUnavailable, actionResponse{Status: "error", Message: "docker_client_unavailable"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	var err error
	switch action {
	case "start":
		err = s.docker.StartContainer(ctx, containerID)
	case "restart":
		err = s.docker.RestartContainer(ctx, containerID)
	case "stop":
		err = s.docker.StopContainer(ctx, containerID)
	case "kill":
		err = s.docker.KillContainer(ctx, containerID)
	default:
		writeJSON(w, http.StatusNotFound, actionResponse{Status: "error", Message: "unknown_action"})
		return
	}

	if err != nil {
		log.Printf("container action failed action=%s id=%s err=%v", action, containerID, err)
		writeJSON(w, http.StatusBadGateway, actionResponse{
			Status:  "error",
			Action:  action,
			ID:      containerID,
			Message: err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, actionResponse{
		Status: "ok",
		Action: action,
		ID:     containerID,
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if !s.isOriginAllowed(origin) {
		http.Error(w, "origin_not_allowed", http.StatusForbidden)
		return
	}

	conn, err := s.upg.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade error: %v", err)
		return
	}

	s.hub.Register(conn)
	defer func() {
		s.hub.Unregister(conn)
		_ = conn.Close()
	}()

	conn.SetReadLimit(wsReadLimit)
	_ = conn.SetReadDeadline(time.Now().Add(wsPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(wsPongWait))
	})

	// Send one snapshot immediately so clients do not wait for the first ticker hit.
	_ = conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
	if err := conn.WriteJSON(s.store.Get()); err != nil {
		return
	}

	done := make(chan struct{})
	defer close(done)

	go func() {
		ticker := time.NewTicker(wsPingPeriod)
		defer ticker.Stop()

		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				deadline := time.Now().Add(wsWriteWait)
				if err := conn.WriteControl(websocket.PingMessage, []byte("ping"), deadline); err != nil {
					return
				}
			}
		}
	}()

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}
