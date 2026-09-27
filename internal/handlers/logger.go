package handlers

import (
	"context"
	"log/slog"
)

type loggerCtxKey struct{}

// WithLogger returns a copy of ctx carrying logger as the request-scoped logger.
func WithLogger(ctx context.Context, logger *slog.Logger) context.Context {
	return context.WithValue(ctx, loggerCtxKey{}, logger)
}

// LoggerFromContext returns the logger stored by [WithLogger], or
// [slog.Default] when ctx carries none.
func LoggerFromContext(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(loggerCtxKey{}).(*slog.Logger); ok {
		return l
	}

	return slog.Default()
}
