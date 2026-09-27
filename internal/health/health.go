// Package health provides the health check and version endpoints.
package health

import (
	"log/slog"
	"net/http"

	"github.com/starquake/voidmarch/internal/handlers"
	"github.com/starquake/voidmarch/internal/version"
)

// HandleHealthz reports that the server is up.
func HandleHealthz(logger *slog.Logger) http.Handler {
	type healthStatus struct {
		Status string `json:"status"`
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := handlers.EncodeJSON(w, http.StatusOK, healthStatus{Status: "ok"}); err != nil {
			logger.ErrorContext(r.Context(), "error encoding health response", slog.Any("err", err))
		}
	})
}

// HandleVersion serves the build stamp and the application environment.
func HandleVersion(logger *slog.Logger, appEnv string) http.Handler {
	type versionResponse struct {
		Env     string `json:"env"`
		Version string `json:"version"`
		Commit  string `json:"commit"`
		Date    string `json:"date"`
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		res := versionResponse{
			Env:     appEnv,
			Version: version.Release(),
			Commit:  version.CommitLabel(),
			Date:    version.Date,
		}
		if err := handlers.EncodeJSON(w, http.StatusOK, res); err != nil {
			logger.ErrorContext(
				r.Context(),
				"error encoding version response",
				slog.Any("err", err),
			)
		}
	})
}
