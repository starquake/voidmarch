package server

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/starquake/voidmarch/internal/handlers"
)

const requestIDBytes = 8

func newRequestID() string {
	var b [requestIDBytes]byte
	_, _ = rand.Read(b[:])

	return hex.EncodeToString(b[:])
}

// requestLogger stores a logger carrying a fresh request id on the request
// context.
func requestLogger(base *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqLogger := base.With(slog.String("requestId", newRequestID()))
		next.ServeHTTP(w, r.WithContext(handlers.WithLogger(r.Context(), reqLogger)))
	})
}

// responseWriter records the status code. Unwrap keeps
// [http.ResponseController] working through it.
type responseWriter struct {
	http.ResponseWriter

	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Unwrap() http.ResponseWriter {
	return rw.ResponseWriter
}

// recoverPanic turns a handler panic into a logged error and a 500.
func recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		logger := handlers.LoggerFromContext(ctx)
		defer func() {
			rec := recover()
			if rec == nil {
				return
			}
			if recErr, ok := rec.(error); ok && errors.Is(recErr, http.ErrAbortHandler) {
				logger.WarnContext(ctx, "handler aborted",
					slog.String("method", r.Method),
					slog.String("path", r.URL.Path),
				)

				return
			}
			logger.ErrorContext(ctx, "handler panic recovered",
				slog.Any("panic", rec),
				slog.String("stack", string(debug.Stack())),
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
			)
			http.Error(w, "internal server error", http.StatusInternalServerError)
		}()
		next.ServeHTTP(w, r)
	})
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()
		next.ServeHTTP(rw, r)
		handlers.LoggerFromContext(r.Context()).InfoContext(r.Context(), "request",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", rw.status),
			slog.Duration("duration", time.Since(start)),
		)
	})
}
