package server

import (
	"io/fs"
	"log/slog"
	"net/http"

	"github.com/starquake/voidmarch/internal/config"
	"github.com/starquake/voidmarch/internal/game"
	"github.com/starquake/voidmarch/internal/health"
	"github.com/starquake/voidmarch/internal/players"
)

func addRoutes(
	mux *http.ServeMux,
	logger *slog.Logger,
	cfg *config.Config,
	static fs.FS,
	svc Services,
) {
	// Files served from disk can change under a running server, so their
	// ETags are not cached.
	files := newStaticFiles(static, cfg.WebDir == "")

	mux.Handle("GET /{$}", handleIndex(files))
	mux.Handle("GET /static/", http.StripPrefix("/static", handleStatic(files)))
	mux.Handle("GET /healthz", health.HandleHealthz(logger))
	mux.Handle("GET /version", health.HandleVersion(logger, cfg.AppEnvironment))
	mux.Handle("POST /api/players", players.HandleRegister(logger, svc.Players))
	mux.Handle("GET /ws", game.HandleWS(logger, svc.Hub, svc.Players, cfg.WireLog))
}
