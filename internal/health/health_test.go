package health_test

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	. "github.com/starquake/voidmarch/internal/health"
)

// failingWriter is a ResponseWriter whose body writes always fail.
type failingWriter struct {
	header http.Header
}

func (f *failingWriter) Header() http.Header     { return f.header }
func (*failingWriter) WriteHeader(int)           {}
func (*failingWriter) Write([]byte) (int, error) { return 0, http.ErrHandlerTimeout }

func TestHandleHealthz(t *testing.T) {
	t.Parallel()

	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/healthz", nil)
	HandleHealthz(slog.New(slog.DiscardHandler)).ServeHTTP(w, req)

	if got, want := w.Code, http.StatusOK; got != want {
		t.Errorf("status = %d, want %d", got, want)
	}
	if got, want := w.Body.String(), `"status":"ok"`; !strings.Contains(got, want) {
		t.Errorf("body = %q, should contain %q", got, want)
	}
}

func TestHandleVersion(t *testing.T) {
	t.Parallel()

	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/version", nil)
	HandleVersion(slog.New(slog.DiscardHandler), "development").ServeHTTP(w, req)

	var body struct {
		Env     string `json:"env"`
		Version string `json:"version"`
		Commit  string `json:"commit"`
	}
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}

	if got, want := body.Env, "development"; got != want {
		t.Errorf("env = %q, want %q", got, want)
	}
	if got := body.Version; got == "" {
		t.Error("version is empty")
	}
	if got := body.Commit; got == "" {
		t.Error("commit is empty")
	}
}

func TestHandlers_EncodeError(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		handler func(*slog.Logger) http.Handler
		want    string
	}{
		{name: "healthz", handler: HandleHealthz, want: "error encoding health response"},
		{
			name:    "version",
			handler: func(l *slog.Logger) http.Handler { return HandleVersion(l, "production") },
			want:    "error encoding version response",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			var logs bytes.Buffer
			logger := slog.New(slog.NewTextHandler(&logs, nil))
			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
			tc.handler(logger).ServeHTTP(&failingWriter{header: http.Header{}}, req)

			if got, want := logs.String(), tc.want; !strings.Contains(got, want) {
				t.Errorf("logs = %q, should contain %q", got, want)
			}
		})
	}
}
