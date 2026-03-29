package ws

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	dockercore "docker-hologram/internal/docker"
)

type mockDockerActions struct {
	startCalls int
	err        error
}

func (m *mockDockerActions) StartContainer(context.Context, string) error {
	m.startCalls += 1
	return m.err
}

func (m *mockDockerActions) RestartContainer(context.Context, string) error { return nil }
func (m *mockDockerActions) StopContainer(context.Context, string) error    { return nil }
func (m *mockDockerActions) KillContainer(context.Context, string) error    { return nil }

func newTestServer(t *testing.T, docker DockerActions, opts ServerOptions) *httptest.Server {
	t.Helper()

	hub := NewHub()
	store := dockercore.NewStateStore()
	server := NewServer(hub, store, docker, opts)
	mux := http.NewServeMux()
	server.RegisterRoutes(mux)
	return httptest.NewServer(mux)
}

func TestHandleContainerActionRequiresToken(t *testing.T) {
	docker := &mockDockerActions{}
	ts := newTestServer(t, docker, ServerOptions{
		ActionToken:     "secret-token",
		AllowedOrigins:  map[string]struct{}{"http://localhost:5173": {}},
		ActionRateLimit: 20,
		ActionWindow:    10 * time.Second,
	})
	defer ts.Close()

	req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/container/abc/start", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Origin", "http://localhost:5173")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected status %d got %d", http.StatusUnauthorized, resp.StatusCode)
	}
	if docker.startCalls != 0 {
		t.Fatalf("start action should not be called on unauthorized request")
	}
}

func TestHandleContainerActionStartAuthorized(t *testing.T) {
	docker := &mockDockerActions{}
	ts := newTestServer(t, docker, ServerOptions{
		ActionToken:     "secret-token",
		AllowedOrigins:  map[string]struct{}{"http://localhost:5173": {}},
		ActionRateLimit: 20,
		ActionWindow:    10 * time.Second,
	})
	defer ts.Close()

	req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/container/abc/start", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("X-Action-Token", "secret-token")
	req.RemoteAddr = "127.0.0.1:1234"

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status %d got %d", http.StatusOK, resp.StatusCode)
	}

	var body actionResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Status != "ok" || body.Action != "start" || body.ID != "abc" {
		t.Fatalf("unexpected response body: %+v", body)
	}
	if docker.startCalls != 1 {
		t.Fatalf("expected start to be called once, got %d", docker.startCalls)
	}
}

func TestHandleContainerActionRateLimited(t *testing.T) {
	docker := &mockDockerActions{}
	ts := newTestServer(t, docker, ServerOptions{
		ActionToken:     "secret-token",
		AllowedOrigins:  map[string]struct{}{"http://localhost:5173": {}},
		ActionRateLimit: 1,
		ActionWindow:    time.Minute,
	})
	defer ts.Close()

	makeReq := func() int {
		req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/container/abc/start", nil)
		if err != nil {
			t.Fatalf("new request: %v", err)
		}
		req.Header.Set("Origin", "http://localhost:5173")
		req.Header.Set("X-Action-Token", "secret-token")
		req.RemoteAddr = "127.0.0.1:3333"

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("do request: %v", err)
		}
		defer resp.Body.Close()
		return resp.StatusCode
	}

	if got := makeReq(); got != http.StatusOK {
		t.Fatalf("first request expected %d got %d", http.StatusOK, got)
	}
	if got := makeReq(); got != http.StatusTooManyRequests {
		t.Fatalf("second request expected %d got %d", http.StatusTooManyRequests, got)
	}
}
