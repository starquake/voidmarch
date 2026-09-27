package app_test

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	. "github.com/starquake/voidmarch/cmd/voidmarch/app"
	"github.com/starquake/voidmarch/internal/testutil"
)

func envFunc(env map[string]string) func(string) string {
	return func(key string) string { return env[key] }
}

func TestRun_InvalidConfig(t *testing.T) {
	t.Parallel()

	err := Run(
		t.Context(),
		envFunc(map[string]string{"APP_ENV": "staging"}),
		testutil.NewTestWriter(t),
		nil,
	)

	if got, want := err.Error(), "error parsing config"; !strings.Contains(got, want) {
		t.Errorf("err.Error() = %q, should contain %q", got, want)
	}
}

func TestRun_ListenError(t *testing.T) {
	t.Parallel()

	busy, err := (&net.ListenConfig{}).Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = busy.Close() })

	_, port, err := net.SplitHostPort(busy.Addr().String())
	if err != nil {
		t.Fatalf("split host port: %v", err)
	}

	err = Run(
		t.Context(),
		envFunc(map[string]string{"HOST": "127.0.0.1", "PORT": port}),
		testutil.NewTestWriter(t),
		nil,
	)

	if got, want := err.Error(), "error listening"; !strings.Contains(got, want) {
		t.Errorf("err.Error() = %q, should contain %q", got, want)
	}
}

func TestRun_ShutsDownOnCancel(t *testing.T) {
	t.Parallel()

	if testing.Short() {
		t.Skip("integration: starts a real server")
	}

	ctx, cancel := context.WithCancel(t.Context())
	stdout := testutil.NewTestWriter(t)

	ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	_, port, err := net.SplitHostPort(ln.Addr().String())
	if err != nil {
		t.Fatalf("split host port: %v", err)
	}

	errCh := make(chan error, 1)
	go func() { errCh <- Run(ctx, envFunc(nil), stdout, ln) }()

	healthz := "http://" + ln.Addr().String() + "/healthz"
	if err := testutil.WaitForReady(ctx, t, 10*time.Second, healthz); err != nil {
		t.Fatalf("WaitForReady() error = %v", err)
	}

	if err := Healthcheck(t.Context(), envFunc(map[string]string{"PORT": port})); err != nil {
		t.Errorf("Healthcheck() error = %v", err)
	}

	http.DefaultClient.CloseIdleConnections()
	stdout.Disable()
	cancel()

	select {
	case err := <-errCh:
		if err != nil {
			t.Errorf("Run() error = %v, want nil", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Run() did not return after cancel")
	}
}

func TestRunHTTPServer_ServeError(t *testing.T) {
	t.Parallel()

	ln, err := (&net.ListenConfig{}).Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	_ = ln.Close()

	err = RunHTTPServer(t.Context(), t.Context(), ln, nil, discardLogger())

	if got, want := err.Error(), "error serving http"; !strings.Contains(got, want) {
		t.Errorf("err.Error() = %q, should contain %q", got, want)
	}
	if got, want := err, net.ErrClosed; !errors.Is(got, want) {
		t.Errorf("err = %v, want %v", got, want)
	}
}
