package server_test

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/starquake/voidmarch/internal/handlers"
	. "github.com/starquake/voidmarch/internal/server"
)

func serveWithLogs(t *testing.T, h http.Handler) (*httptest.ResponseRecorder, string) {
	t.Helper()

	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/boom", nil)
	RequestLogger(logger, h).ServeHTTP(w, req)

	return w, logs.String()
}

func TestRecoverPanic(t *testing.T) {
	t.Parallel()

	w, logs := serveWithLogs(
		t,
		RecoverPanic(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			panic("boom")
		})),
	)

	if got, want := w.Code, http.StatusInternalServerError; got != want {
		t.Errorf("status = %d, want %d", got, want)
	}
	if got, want := logs, "handler panic recovered"; !strings.Contains(got, want) {
		t.Errorf("logs = %q, should contain %q", got, want)
	}
	if got, want := logs, "requestId="; !strings.Contains(got, want) {
		t.Errorf("logs = %q, should contain %q", got, want)
	}
}

func TestRecoverPanic_Abort(t *testing.T) {
	t.Parallel()

	w, logs := serveWithLogs(
		t,
		RecoverPanic(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			panic(http.ErrAbortHandler)
		})),
	)

	if got, want := w.Code, http.StatusOK; got != want {
		t.Errorf("status = %d, want %d (nothing written)", got, want)
	}
	if got, want := logs, "handler aborted"; !strings.Contains(got, want) {
		t.Errorf("logs = %q, should contain %q", got, want)
	}
}

func TestRecoverPanic_NoPanic(t *testing.T) {
	t.Parallel()

	w, logs := serveWithLogs(
		t,
		RecoverPanic(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusTeapot)
		})),
	)

	if got, want := w.Code, http.StatusTeapot; got != want {
		t.Errorf("status = %d, want %d", got, want)
	}
	if got := logs; got != "" {
		t.Errorf("logs = %q, want none", got)
	}
}

func TestLogRequests(t *testing.T) {
	t.Parallel()

	w, logs := serveWithLogs(
		t,
		LogRequests(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusAccepted)
			if err := http.NewResponseController(w).Flush(); err != nil {
				t.Errorf("Flush() through the wrapped writer error = %v", err)
			}
		})),
	)

	if got, want := w.Code, http.StatusAccepted; got != want {
		t.Errorf("status = %d, want %d", got, want)
	}
	for _, want := range []string{"msg=request", "status=202", "path=/boom"} {
		if got := logs; !strings.Contains(got, want) {
			t.Errorf("logs = %q, should contain %q", got, want)
		}
	}
}

func TestRequestLogger_StoresLogger(t *testing.T) {
	t.Parallel()

	_, logs := serveWithLogs(t, http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		handlers.LoggerFromContext(r.Context()).InfoContext(r.Context(), "inside")
	}))

	if got, want := logs, "requestId="; !strings.Contains(got, want) {
		t.Errorf("logs = %q, should contain %q", got, want)
	}
}
