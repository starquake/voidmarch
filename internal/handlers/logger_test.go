package handlers_test

import (
	"log/slog"
	"testing"

	. "github.com/starquake/voidmarch/internal/handlers"
)

func TestLoggerFromContext(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.DiscardHandler)
	ctx := WithLogger(t.Context(), logger)

	if got, want := LoggerFromContext(ctx), logger; got != want {
		t.Errorf("LoggerFromContext() = %p, want %p", got, want)
	}
}

func TestLoggerFromContext_Default(t *testing.T) {
	t.Parallel()

	if got, want := LoggerFromContext(t.Context()), slog.Default(); got != want {
		t.Errorf("LoggerFromContext() = %p, want slog.Default() %p", got, want)
	}
}
