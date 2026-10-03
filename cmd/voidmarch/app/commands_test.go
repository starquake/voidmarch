package app_test

import (
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	. "github.com/starquake/voidmarch/cmd/voidmarch/app"
	"github.com/starquake/voidmarch/internal/config"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}

func portOf(t *testing.T, rawURL string) string {
	t.Helper()

	u, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("url.Parse(%q) error = %v", rawURL, err)
	}

	return u.Port()
}

func TestHealthcheck(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		status  int
		wantErr error
	}{
		{name: "healthy", status: http.StatusOK, wantErr: nil},
		{name: "unhealthy", status: http.StatusServiceUnavailable, wantErr: ErrUnhealthy},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			srv := httptest.NewServer(
				http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if got, want := r.URL.Path, "/healthz"; got != want {
						t.Errorf("path = %q, want %q", got, want)
					}
					w.WriteHeader(tc.status)
				}),
			)
			t.Cleanup(srv.Close)

			err := Healthcheck(t.Context(), envFunc(map[string]string{"PORT": portOf(t, srv.URL)}))
			if got, want := err, tc.wantErr; !errors.Is(got, want) {
				t.Errorf("Healthcheck() error = %v, want %v", got, want)
			}
		})
	}
}

func TestHealthcheck_NoServer(t *testing.T) {
	t.Parallel()

	ln, err := (&net.ListenConfig{}).Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := portOf(t, "http://"+ln.Addr().String())
	_ = ln.Close()

	err = Healthcheck(t.Context(), envFunc(map[string]string{"PORT": port}))

	if got, want := err.Error(), "error calling"; !strings.Contains(got, want) {
		t.Errorf("err.Error() = %q, should contain %q", got, want)
	}
}

func TestHealthcheck_InvalidConfig(t *testing.T) {
	t.Parallel()

	err := Healthcheck(t.Context(), envFunc(map[string]string{"PORT": "nope"}))

	if got, want := err.Error(), "error parsing config"; !strings.Contains(got, want) {
		t.Errorf("err.Error() = %q, should contain %q", got, want)
	}
}

func TestNewSeason(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "voidmarch.db")
	getenv := func(key string) string {
		if key == "DB_PATH" {
			return path
		}

		return ""
	}
	var out strings.Builder
	if err := NewSeason(t.Context(), getenv, &out); err != nil {
		t.Fatalf("NewSeason() error = %v", err)
	}
	if got, want := out.String(), "a new season started in "+path; !strings.Contains(got, want) {
		t.Errorf("NewSeason() printed %q, should contain %q", got, want)
	}

	missing := func(key string) string {
		if key == "DB_PATH" {
			return filepath.Join(t.TempDir(), "nowhere", "voidmarch.db")
		}

		return ""
	}
	if err := NewSeason(t.Context(), missing, &out); !errors.Is(err, config.ErrInvalidDBPath) {
		t.Errorf(
			"NewSeason() in a missing directory error = %v, want %v",
			err,
			config.ErrInvalidDBPath,
		)
	}
}
