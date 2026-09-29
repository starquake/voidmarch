// Package app wires the Voidmarch server together and runs it.
package app

import (
	"context"
	"database/sql"
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
	"github.com/starquake/voidmarch/internal/store"
	"github.com/starquake/voidmarch/internal/version"
	"github.com/starquake/voidmarch/internal/web"
)

// fleetSaveTimeout bounds a save of the fleet, so a stuck disk can't hold up
// shutdown for long.
const fleetSaveTimeout = 5 * time.Second

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

	db, err := store.Open(signalCtx, cfg.DBPath)
	if err != nil {
		msg := "error opening database"
		logger.ErrorContext(signalCtx, msg, slog.Any("err", err))

		return fmt.Errorf("%s: %w", msg, err)
	}
	// Deferred first, so it closes after the hub and the HTTP server stop.
	defer func() { _ = db.Close() }()

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

	poolStart, err := fleetStart(signalCtx, db, cfg.PoolStart)
	if err != nil {
		logger.ErrorContext(signalCtx, "error reading hangar", slog.Any("err", err))

		return err
	}
	hub := game.NewHub(logger,
		game.WithPoolStart(poolStart),
		game.WithSaveFleet(fleetSaver(signalCtx, logger, db)),
	)
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

	svc := server.Services{Players: players.NewStore(db), Hub: hub}

	return runHTTPServer(ctx, signalCtx, ln, server.New(logger, cfg, static, svc), logger)
}

// fleetStart is the saved fleet, or poolStart on a fresh database.
func fleetStart(ctx context.Context, db *sql.DB, poolStart int) (int, error) {
	ships, ok, err := store.Hangar(ctx, db)
	if err != nil {
		return 0, fmt.Errorf("error loading fleet: %w", err)
	}
	if !ok {
		return poolStart, nil
	}

	return ships, nil
}

// fleetSaver saves the hub's fleet. It outlives ctx's cancellation, since the
// hub saves once more while it stops.
func fleetSaver(ctx context.Context, logger *slog.Logger, db *sql.DB) func(int) {
	ctx = context.WithoutCancel(ctx)

	return func(ships int) {
		saveCtx, cancel := context.WithTimeout(ctx, fleetSaveTimeout)
		defer cancel()
		if err := store.SaveHangar(saveCtx, db, ships); err != nil {
			logger.ErrorContext(saveCtx, "error saving fleet", slog.Any("err", err))
		}
	}
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
