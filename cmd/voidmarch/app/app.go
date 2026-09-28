// Package app wires the Voidmarch server together and runs it.
package app

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/starquake/voidmarch/internal/config"
	"github.com/starquake/voidmarch/internal/game"
	"github.com/starquake/voidmarch/internal/players"
	"github.com/starquake/voidmarch/internal/server"
	"github.com/starquake/voidmarch/internal/version"
	"github.com/starquake/voidmarch/internal/web"
)

// Run starts the server and blocks until ctx is canceled or the process gets
// SIGINT or SIGTERM. When ln is nil, Run listens on the configured address.
func Run(ctx context.Context, getenv func(string) string, stdout io.Writer, ln net.Listener) error {
	signalCtx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()

	logger := slog.New(slog.NewTextHandler(stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))

	cfg, err := config.Parse(getenv)
	if err != nil {
		msg := "error parsing config"
		logger.ErrorContext(signalCtx, msg, slog.Any("err", err))

		return fmt.Errorf("%s: %w", msg, err)
	}

	logger.InfoContext(signalCtx, "starting voidmarch",
		slog.String("version", version.Release()),
		slog.String("commit", version.CommitLabel()),
		slog.String("env", cfg.AppEnvironment),
	)

	static, err := staticFiles(cfg)
	if err != nil {
		return err
	}

	if ln == nil {
		ln, err = (&net.ListenConfig{}).Listen(signalCtx, "tcp", cfg.Addr())
		if err != nil {
			msg := "error listening"
			logger.ErrorContext(
				signalCtx,
				msg,
				slog.String("addr", cfg.Addr()),
				slog.Any("err", err),
			)

			return fmt.Errorf("%s on %s: %w", msg, cfg.Addr(), err)
		}
	}

	hub := game.NewHub(logger)
	ticker := time.NewTicker(time.Second / game.TickRate)
	defer ticker.Stop()
	hubDone := make(chan struct{})
	go func() {
		defer close(hubDone)
		hub.Run(signalCtx, ticker.C)
	}()
	// The hub stops with the signal; waiting keeps Run from returning while it
	// still closes its sessions.
	defer func() { <-hubDone }()

	svc := server.Services{Players: players.NewStore(), Hub: hub}

	return runHTTPServer(ctx, signalCtx, ln, server.New(logger, cfg, static, svc), logger)
}

// staticFiles returns the web client: from WEB_DIR when set, else embedded.
func staticFiles(cfg *config.Config) (fs.FS, error) {
	if cfg.WebDir != "" {
		return os.DirFS(cfg.WebDir), nil
	}

	static, err := web.Static()
	if err != nil {
		return nil, fmt.Errorf("error loading web client: %w", err)
	}

	return static, nil
}
