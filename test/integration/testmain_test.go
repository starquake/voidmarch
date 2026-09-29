// Package integration_test drives a real server end to end.
package integration_test

import (
	"context"
	"errors"
	"io"
	"maps"
	"net"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	"github.com/starquake/voidmarch/cmd/voidmarch/app"
	"github.com/starquake/voidmarch/internal/testutil"
)

// startServer boots the server on an ephemeral port, waits for /healthz and
// returns its base URL. extraEnv is layered over the defaults, which give
// each server its own database. The server is stopped on cleanup.
func startServer(t *testing.T, extraEnv map[string]string) string {
	t.Helper()

	if testing.Short() {
		t.Skip("integration: needs a real server")
	}

	ctx, stop := testutil.SignalCtx(t)
	stdout := testutil.NewTestWriter(t)

	env := map[string]string{
		"APP_ENV": "development",
		"HOST":    "127.0.0.1",
		"PORT":    "0",
		"DB_PATH": filepath.Join(t.TempDir(), "voidmarch.db"),
	}
	maps.Copy(env, extraEnv)
	getenv := func(key string) string { return env[key] }

	ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", net.JoinHostPort(env["HOST"], env["PORT"]))
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}

	errCh := make(chan error, 1)
	go func() { errCh <- app.Run(ctx, getenv, stdout, ln) }()

	baseURL := "http://" + ln.Addr().String()
	if err := testutil.WaitForReady(ctx, t, 10*time.Second, baseURL+"/healthz"); err != nil {
		t.Fatalf("error waiting for server to be ready: %v", err)
	}

	t.Cleanup(func() {
		// An unused connection the transport dialed would hold up Shutdown.
		http.DefaultClient.CloseIdleConnections()
		stdout.Disable()
		stop()
		select {
		case err := <-errCh:
			if err != nil && !errors.Is(err, context.Canceled) {
				t.Errorf("server exited with error: %v", err)
			}
		case <-time.After(10 * time.Second):
			t.Error("server timed out during shutdown")
		}
	})

	return baseURL
}

// response is a fully read HTTP response.
type response struct {
	status int
	header http.Header
	body   string
}

// get fetches url and reads the whole response.
func get(t *testing.T, url string) response {
	t.Helper()

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("http.NewRequestWithContext() error = %v", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s error = %v", url, err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}

	return response{status: resp.StatusCode, header: resp.Header, body: string(body)}
}
