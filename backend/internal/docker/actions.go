package docker

import (
	"context"
	"fmt"

	typescontainer "github.com/docker/docker/api/types/container"
)

func (c *Client) RestartContainer(ctx context.Context, containerID string) error {
	if c == nil || c.cli == nil {
		return fmt.Errorf("docker client is nil")
	}

	return c.cli.ContainerRestart(ctx, containerID, typescontainer.StopOptions{})
}

func (c *Client) StopContainer(ctx context.Context, containerID string) error {
	if c == nil || c.cli == nil {
		return fmt.Errorf("docker client is nil")
	}

	return c.cli.ContainerStop(ctx, containerID, typescontainer.StopOptions{})
}

func (c *Client) KillContainer(ctx context.Context, containerID string) error {
	if c == nil || c.cli == nil {
		return fmt.Errorf("docker client is nil")
	}

	return c.cli.ContainerKill(ctx, containerID, "SIGKILL")
}
