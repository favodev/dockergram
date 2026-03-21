package docker

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/docker/docker/client"
)

// Client wraps Docker SDK access.
type Client struct {
	cli *client.Client
}

func NewClient() (*Client, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("create docker client: %w", err)
	}
	return &Client{cli: cli}, nil
}

func (c *Client) Close() error {
	if c == nil || c.cli == nil {
		return nil
	}
	return c.cli.Close()
}

func (c *Client) SDK() *client.Client {
	if c == nil {
		return nil
	}
	return c.cli
}

// Ping verifies Docker availability and maps errors to frontend-friendly messages.
func (c *Client) Ping(ctx context.Context) HealthSignal {
	signal := HealthSignal{Status: "ok", Timestamp: NewTimestampMillis()}
	if c == nil || c.cli == nil {
		signal.Status = "error"
		signal.Message = "client_unavailable"
		return signal
	}

	_, err := c.cli.Ping(ctx)
	if err == nil {
		return signal
	}

	signal.Status = "error"
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "permission denied"):
		signal.Message = "permission_denied"
	case strings.Contains(msg, "cannot connect") || strings.Contains(msg, "is the docker daemon running"):
		signal.Message = "daemon_down"
	case errors.Is(err, context.DeadlineExceeded):
		signal.Message = "timeout"
	default:
		signal.Message = "docker_unavailable"
	}

	return signal
}
