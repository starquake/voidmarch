package app

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/starquake/voidmarch/internal/config"
)

const healthcheckTimeout = 3 * time.Second

// ErrUnhealthy is returned by [Healthcheck] when /healthz does not answer 200.
var ErrUnhealthy = errors.New("server is unhealthy")

// Healthcheck probes the local server's /healthz. It serves as the Docker
// HEALTHCHECK, since the distroless image has no curl.
func Healthcheck(ctx context.Context, getenv func(string) string) error {
	cfg, err := config.Parse(getenv)
	if err != nil {
		return fmt.Errorf("error parsing config: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, healthcheckTimeout)
	defer cancel()

	url := "http://" + net.JoinHostPort("127.0.0.1", cfg.Port) + "/healthz"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("error creating healthcheck request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("error calling %s: %w", url, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: %s returned %d", ErrUnhealthy, url, resp.StatusCode)
	}

	return nil
}
