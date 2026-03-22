package ws

import (
	"log"
	"net/http"
	"time"

	dockercore "docker-hologram/internal/docker"

	"github.com/gorilla/websocket"
)

// Server exposes websocket endpoints.
type Server struct {
	hub   *Hub
	store *dockercore.StateStore
	upg   websocket.Upgrader
}

func NewServer(hub *Hub, store *dockercore.StateStore) *Server {
	return &Server{
		hub:   hub,
		store: store,
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
