package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"
)

const (
	readHeaderTimeout = 5 * time.Second
	readTimeout       = 10 * time.Second
	writeTimeout      = 10 * time.Second
	idleTimeout       = 120 * time.Second
	// shutdownTimeout exceeds the 5s after which Shutdown treats a connection
	// that never sent a request (a browser preconnect) as idle, and stays under
	// Docker's 10s stop timeout.
	shutdownTimeout = 8 * time.Second
)

// runHTTPServer serves on ln until signalCtx is done, then shuts down
// gracefully. The shutdown deadline derives from ctx without its
// cancellation, because ctx may be the very context that ended serving.
func runHTTPServer(
	ctx, signalCtx context.Context,
	ln net.Listener,
	handler http.Handler,
	logger *slog.Logger,
) error {
	httpServer := &http.Server{
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
		Handler:           handler,
	}

	serveErr := make(chan error, 1)
	go func() {
		logger.InfoContext(
			signalCtx,
			"listening",
			slog.String("url", "http://"+ln.Addr().String()+"/"),
		)
		serveErr <- httpServer.Serve(ln)
	}()

	select {
	case err := <-serveErr:
		msg := "error serving http"
		logger.ErrorContext(signalCtx, msg, slog.Any("err", err))

		return fmt.Errorf("%s: %w", msg, err)
	case <-signalCtx.Done():
	}

	logger.InfoContext(ctx, "shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), shutdownTimeout)
	defer cancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		msg := "error shutting down http server"
		logger.ErrorContext(shutdownCtx, msg, slog.Any("err", err))

		return fmt.Errorf("%s: %w", msg, err)
	}

	if err := <-serveErr; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("error serving http: %w", err)
	}

	return nil
}
