// Package server builds the HTTP handler: routes and middleware.
package server

import (
	"io/fs"
	"log/slog"
	"net/http"

	"github.com/starquake/voidmarch/internal/config"
	"github.com/starquake/voidmarch/internal/players"
)

// Services bundles the stateful parts the handlers share.
type Services struct {
	Players *players.Store
}

// New returns the server's HTTP handler. static holds the web client files.
func New(logger *slog.Logger, cfg *config.Config, static fs.FS, svc Services) http.Handler {
	mux := http.NewServeMux()
	addRoutes(mux, logger, cfg, static, svc)

	var handler http.Handler = mux
	// Innermost, so the headers are set before any handler writes, including
	// the 500 recoverPanic sends.
	handler = securityHeaders(cfg)(handler)
	handler = logRequests(handler)
	handler = recoverPanic(handler)
	// Outermost, so every other layer logs with the request id.
	handler = requestLogger(logger, handler)

	return handler
}
