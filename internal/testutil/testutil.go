// Package testutil contains helpers for tests.
package testutil

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"testing"
	"time"
)

const (
	clientTimeout             = 5 * time.Second
	waitForReadyRetryInterval = 100 * time.Millisecond
)

// SignalCtx returns a context canceled when the test ends or is interrupted.
func SignalCtx(t *testing.T) (context.Context, context.CancelFunc) {
	t.Helper()

	ctx, stop := signal.NotifyContext(t.Context(), os.Interrupt)
	t.Cleanup(stop)

	return ctx, stop
}

// TestWriter is an [io.Writer] that forwards to tb.Log until disabled. Calling
// tb.Log after a test completes panics, so a server still logging during
// shutdown must have its writer disabled first.
type TestWriter struct {
	tb   testing.TB
	mu   sync.Mutex
	done bool
}

// NewTestWriter returns a TestWriter for tb, disabled automatically on cleanup.
func NewTestWriter(tb testing.TB) *TestWriter {
	tb.Helper()

	w := &TestWriter{tb: tb}
	tb.Cleanup(w.Disable)

	return w
}

// Disable stops forwarding; later writes are dropped.
func (w *TestWriter) Disable() {
	w.mu.Lock()
	defer w.mu.Unlock()

	w.done = true
}

// Write forwards p to tb.Log unless the writer is disabled.
func (w *TestWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if !w.done {
		w.tb.Logf("%s", p)
	}

	return len(p), nil
}

// WaitForReady polls endpoint until it answers 200, ctx is done or timeout
// passes.
func WaitForReady(ctx context.Context, t *testing.T, timeout time.Duration, endpoint string) error {
	t.Helper()

	client := http.Client{Timeout: clientTimeout}
	ticker := time.NewTicker(waitForReadyRetryInterval)
	defer ticker.Stop()

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return fmt.Errorf("error creating request: %w", err)
		}

		resp, err := client.Do(req)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}

		select {
		case <-ctx.Done():
			return fmt.Errorf("timeout waiting for %s: %w", endpoint, ctx.Err())
		case <-ticker.C:
		}
	}
}
