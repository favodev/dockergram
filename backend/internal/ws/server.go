package ws

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	dockercore "docker-hologram/internal/docker"

	"github.com/gorilla/websocket"
)

// Server exposes websocket endpoints.
type Server struct {
	hub    *Hub
	store  *dockercore.StateStore
	docker *dockercore.Client
	upg    websocket.Upgrader
}

func NewServer(hub *Hub, store *dockercore.StateStore, dockerClient *dockercore.Client) *Server {
	return &Server{
		hub:    hub,
		store:  store,
		docker: dockerClient,
		upg: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true
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

func applyCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}

func (s *Server) handleContainerAction(w http.ResponseWriter, r *http.Request) {
	applyCORS(w)
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

	// Send one snapshot immediately so clients do not wait for the first ticker hit.
	_ = conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
	if err := conn.WriteJSON(s.store.Get()); err != nil {
		return
	}

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}
