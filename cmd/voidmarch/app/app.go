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
	"github.com/starquake/voidmarch/internal/sim"
	"github.com/starquake/voidmarch/internal/store"
	"github.com/starquake/voidmarch/internal/version"
	"github.com/starquake/voidmarch/internal/web"
)

// expiryInterval is how often unused registrations are cleared (#19).
const expiryInterval = time.Hour

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

	playerStore := players.NewStore(db)
	stopExpiry := startExpiry(signalCtx, logger, playerStore)
	defer stopExpiry()

	if ln == nil {
		if ln, err = listen(signalCtx, logger, cfg); err != nil {
			return err
		}
	}

	poolStart, err := fleetStart(signalCtx, db, cfg.PoolStart)
	if err != nil {
		logger.ErrorContext(signalCtx, "error reading hangar", slog.Any("err", err))

		return err
	}
	hubOptions := []game.HubOption{
		game.WithPoolStart(poolStart),
		game.WithSaveFleet(fleetSaver(signalCtx, logger, db)),
		game.WithSaveUnlock(unlockSaver(signalCtx, logger, playerStore)),
		game.WithSaveLoadout(loadoutSaver(signalCtx, logger, playerStore)),
	}
	if cfg.DropChance != nil {
		hubOptions = append(hubOptions, game.WithDropChance(*cfg.DropChance))
	}
	hub := game.NewHub(logger, hubOptions...)
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

	svc := server.Services{Players: playerStore, Hub: hub}

	return runHTTPServer(ctx, signalCtx, ln, server.New(logger, cfg, static, svc), logger)
}

// listen opens the configured address.
func listen(ctx context.Context, logger *slog.Logger, cfg *config.Config) (net.Listener, error) {
	ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", cfg.Addr())
	if err != nil {
		msg := "error listening"
		logger.ErrorContext(ctx, msg, slog.String("addr", cfg.Addr()), slog.Any("err", err))

		return nil, fmt.Errorf("%s on %s: %w", msg, cfg.Addr(), err)
	}

	return ln, nil
}

// startExpiry runs expireUnused in the background and returns the function
// that stops it and waits, so returning early doesn't wait for a signal.
func startExpiry(ctx context.Context, logger *slog.Logger, playerStore *players.Store) func() {
	ctx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		expireUnused(ctx, logger, playerStore)
	}()

	return func() {
		cancel()
		<-done
	}
}

// expireUnused clears the registrations that never connected, now and every
// expiryInterval, until ctx is canceled.
func expireUnused(ctx context.Context, logger *slog.Logger, playerStore *players.Store) {
	ticker := time.NewTicker(expiryInterval)
	defer ticker.Stop()
	for {
		n, err := playerStore.Expire(ctx)
		if err != nil && ctx.Err() == nil {
			logger.ErrorContext(ctx, "error expiring players", slog.Any("err", err))
		}
		if n > 0 {
			logger.InfoContext(ctx, "unused registrations expired", slog.Int("players", n))
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
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

// unlockSaver saves the parts the hub grants. Like fleetSaver, it outlives
// ctx's cancellation, since the hub drains its saves while it stops.
func unlockSaver(
	ctx context.Context,
	logger *slog.Logger,
	playerStore *players.Store,
) func(string, sim.Part, sim.Tier) {
	ctx = context.WithoutCancel(ctx)

	return func(player string, part sim.Part, tier sim.Tier) {
		saveCtx, cancel := context.WithTimeout(ctx, fleetSaveTimeout)
		defer cancel()
		if err := playerStore.SaveUnlock(saveCtx, player, part, tier); err != nil {
			logger.ErrorContext(saveCtx, "error saving unlock", slog.Any("err", err))
		}
	}
}

// loadoutSaver saves the loadouts players fit at home, like unlockSaver.
func loadoutSaver(
	ctx context.Context,
	logger *slog.Logger,
	playerStore *players.Store,
) func(string, sim.Loadout) {
	ctx = context.WithoutCancel(ctx)

	return func(player string, l sim.Loadout) {
		saveCtx, cancel := context.WithTimeout(ctx, fleetSaveTimeout)
		defer cancel()
		if err := playerStore.SaveLoadout(saveCtx, player, l); err != nil {
			logger.ErrorContext(saveCtx, "error saving loadout", slog.Any("err", err))
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
