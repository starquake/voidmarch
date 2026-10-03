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
	"github.com/starquake/voidmarch/internal/world"
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

	hub, err := newHub(signalCtx, logger, cfg, db, playerStore)
	if err != nil {
		return err
	}
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

// newHub makes the hub, its hangar started from the saved fleet, saving
// what it grants and fits to the database.
func newHub(
	ctx context.Context,
	logger *slog.Logger,
	cfg *config.Config,
	db *sql.DB,
	playerStore *players.Store,
) (*game.Hub, error) {
	poolStart, err := fleetStart(ctx, db, cfg.PoolStart)
	if err != nil {
		logger.ErrorContext(ctx, "error reading hangar", slog.Any("err", err))

		return nil, err
	}
	m, err := world.Load(cfg.Map)
	if err != nil {
		return nil, fmt.Errorf("error loading map: %w", err)
	}
	cleared, err := store.ClearedSectors(ctx, db)
	if err != nil {
		logger.ErrorContext(ctx, "error reading cleared sectors", slog.Any("err", err))

		return nil, fmt.Errorf("error starting the hub: %w", err)
	}
	frontier, err := frontierOptions(ctx, logger, db)
	if err != nil {
		logger.ErrorContext(ctx, "error reading the frontier", slog.Any("err", err))

		return nil, fmt.Errorf("error starting the hub: %w", err)
	}
	hubOptions := []game.HubOption{
		game.WithMap(m),
		game.WithPoolStart(poolStart),
		game.WithSaveFleet(fleetSaver(ctx, logger, db)),
		game.WithSaveUnlock(unlockSaver(ctx, logger, playerStore)),
		game.WithSaveLoadout(loadoutSaver(ctx, logger, playerStore)),
		game.WithSaveStats(statsSaver(ctx, logger, playerStore)),
		game.WithClearedSectors(cleared),
		game.WithSaveSector(sectorSaver(ctx, logger, db)),
		game.WithForgetSector(sectorForgetter(ctx, logger, db)),
	}
	hubOptions = append(hubOptions, frontier...)
	if !cfg.IsProduction() {
		hubOptions = append(hubOptions, game.WithDevelopment())
	}
	if cfg.DropChance != nil {
		hubOptions = append(hubOptions, game.WithDropChance(*cfg.DropChance))
	}

	return game.NewHub(logger, hubOptions...), nil
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

// sectorSaver saves the sectors the hub clears, like fleetSaver.
func sectorSaver(ctx context.Context, logger *slog.Logger, db *sql.DB) func(string) {
	ctx = context.WithoutCancel(ctx)

	return func(name string) {
		saveCtx, cancel := context.WithTimeout(ctx, fleetSaveTimeout)
		defer cancel()
		if err := store.ClearSector(saveCtx, db, name, time.Now()); err != nil {
			logger.ErrorContext(saveCtx, "error saving cleared sector", slog.Any("err", err))
		}
	}
}

// frontierOptions are the hub's open rings, each faction's Dreadnought's
// health as saved, the hours since regenerating it, whether the season is
// won, and their savers (#123, #124, #140, #153).
func frontierOptions(
	ctx context.Context,
	logger *slog.Logger,
	db *sql.DB,
) ([]game.HubOption, error) {
	rings, saved, err := store.OpenRings(ctx, db)
	if err != nil {
		return nil, fmt.Errorf("error reading open rings: %w", err)
	}
	if !saved {
		rings = 1
	}
	dreadnoughts, err := store.Dreadnoughts(ctx, db)
	if err != nil {
		return nil, fmt.Errorf("error reading the dreadnoughts: %w", err)
	}
	season, err := store.CurrentSeason(ctx, db)
	if err != nil {
		return nil, fmt.Errorf("error reading the season: %w", err)
	}
	ctx = context.WithoutCancel(ctx)
	save := func(what string, do func(context.Context) error) {
		saveCtx, cancel := context.WithTimeout(ctx, fleetSaveTimeout)
		defer cancel()
		if err := do(saveCtx); err != nil {
			logger.ErrorContext(saveCtx, "error saving "+what, slog.Any("err", err))
		}
	}

	opts := []game.HubOption{
		game.WithOpenRings(rings),
		game.WithSaveOpenRings(func(n int) {
			save(
				"open rings",
				func(c context.Context) error { return store.SaveOpenRings(c, db, n) },
			)
		}),
		game.WithSaveDreadnought(func(faction sim.EnemyFaction, share float64) {
			save("a dreadnought", func(c context.Context) error {
				return store.SaveDreadnoughtHealth(c, db, string(faction), share, time.Now())
			})
		}),
		game.WithSaveSeasonWon(func() {
			save("the season won", func(c context.Context) error {
				return store.SaveSeasonWon(c, db, time.Now())
			})
		}),
	}
	if !season.Won.IsZero() {
		opts = append(opts, game.WithSeasonWon())
	}
	for faction, d := range dreadnoughts {
		share := sim.DreadnoughtRegen(d.Health, time.Since(d.At).Hours())
		opts = append(opts, game.WithDreadnought(sim.EnemyFaction(faction), share))
	}

	return opts, nil
}

// sectorForgetter saves a sector the enemy took back, like sectorSaver.
func sectorForgetter(ctx context.Context, logger *slog.Logger, db *sql.DB) func(string) {
	ctx = context.WithoutCancel(ctx)

	return func(name string) {
		saveCtx, cancel := context.WithTimeout(ctx, fleetSaveTimeout)
		defer cancel()
		if err := store.UnclearSector(saveCtx, db, name); err != nil {
			logger.ErrorContext(saveCtx, "error forgetting cleared sector", slog.Any("err", err))
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

// statsSaver saves a player's season stats, like loadoutSaver (#154).
func statsSaver(
	ctx context.Context,
	logger *slog.Logger,
	playerStore *players.Store,
) func(string, players.Stats) {
	ctx = context.WithoutCancel(ctx)

	return func(player string, st players.Stats) {
		saveCtx, cancel := context.WithTimeout(ctx, fleetSaveTimeout)
		defer cancel()
		if err := playerStore.SaveStats(saveCtx, player, st); err != nil {
			logger.ErrorContext(saveCtx, "error saving stats", slog.Any("err", err))
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
