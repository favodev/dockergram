package ws

import (
	"context"
	"encoding/json"
	"fmt"
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

func TestHandleContainerActionInvalidContainerID(t *testing.T) {
	docker := &mockDockerActions{}
	ts := newTestServer(t, docker, ServerOptions{
		ActionToken:     "secret-token",
		AllowedOrigins:  map[string]struct{}{"http://localhost:5173": {}},
		ActionRateLimit: 20,
		ActionWindow:    10 * time.Second,
	})
	defer ts.Close()

	req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/container/abc$/start", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("X-Action-Token", "secret-token")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected status %d got %d", http.StatusBadRequest, resp.StatusCode)
	}
	if docker.startCalls != 0 {
		t.Fatalf("start action should not be called on invalid container id")
	}
}

func TestHandleContainerActionRejectsEmptyOrigin(t *testing.T) {
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
	req.Header.Set("X-Action-Token", "secret-token")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected status %d got %d", http.StatusForbidden, resp.StatusCode)
	}
	if docker.startCalls != 0 {
		t.Fatalf("start action should not be called when origin is missing")
	}
}

func TestExtractClientIP(t *testing.T) {
	tests := []struct {
		name              string
		trustProxyHeaders bool
		xff               string
		xri               string
		remoteAddr        string
		want              string
	}{
		{
			name:              "uses remote addr when proxy headers disabled",
			trustProxyHeaders: false,
			xff:               "203.0.113.7",
			xri:               "198.51.100.20",
			remoteAddr:        "127.0.0.1:3456",
			want:              "127.0.0.1",
		},
		{
			name:              "uses x-forwarded-for when proxy headers trusted",
			trustProxyHeaders: true,
			xff:               "203.0.113.7, 10.0.0.3",
			xri:               "198.51.100.20",
			remoteAddr:        "127.0.0.1:3456",
			want:              "203.0.113.7",
		},
		{
			name:              "falls back to x-real-ip when x-forwarded-for invalid",
			trustProxyHeaders: true,
			xff:               "not-an-ip",
			xri:               "198.51.100.20",
			remoteAddr:        "127.0.0.1:3456",
			want:              "198.51.100.20",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/container/abc/start", nil)
			req.RemoteAddr = tt.remoteAddr
			if tt.xff != "" {
				req.Header.Set("X-Forwarded-For", tt.xff)
			}
			if tt.xri != "" {
				req.Header.Set("X-Real-IP", tt.xri)
			}

			got := extractClientIP(req, tt.trustProxyHeaders)
			if got != tt.want {
				t.Fatalf("unexpected client ip: got=%s want=%s", got, tt.want)
			}
		})
	}
}

func TestActionRateLimiterCleansExpiredBuckets(t *testing.T) {
	limiter := newActionRateLimiter(1, time.Second)
	now := time.Now()

	for i := 0; i < 24; i += 1 {
		key := fmt.Sprintf("client-%d", i)
		if !limiter.Allow(key, now) {
			t.Fatalf("initial allow should pass for key %s", key)
		}
	}

	if len(limiter.buckets) != 24 {
		t.Fatalf("expected 24 buckets, got %d", len(limiter.buckets))
	}

	if !limiter.Allow("cleanup-trigger", now.Add(2*time.Minute)) {
		t.Fatalf("cleanup trigger request should be allowed")
	}

	if got := len(limiter.buckets); got > 1 {
		t.Fatalf("expected expired buckets to be cleaned, got %d active buckets", got)
	}
}
