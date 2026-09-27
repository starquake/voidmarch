package server

import (
	"io/fs"
	"log/slog"
	"net/http"

	"github.com/starquake/voidmarch/internal/config"
	"github.com/starquake/voidmarch/internal/health"
)

func addRoutes(mux *http.ServeMux, logger *slog.Logger, cfg *config.Config, static fs.FS) {
	// Files served from disk can change under a running server, so their
	// ETags are not cached.
	files := newStaticFiles(static, cfg.WebDir == "")

	mux.Handle("GET /{$}", handleIndex(files))
	mux.Handle("GET /static/", http.StripPrefix("/static", handleStatic(files)))
	mux.Handle("GET /healthz", health.HandleHealthz(logger))
	mux.Handle("GET /version", health.HandleVersion(logger, cfg.AppEnvironment))
}
