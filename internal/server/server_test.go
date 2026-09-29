package server_test

import (
	"io"
	"log/slog"
	"maps"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/starquake/voidmarch/internal/config"
	"github.com/starquake/voidmarch/internal/players"
	. "github.com/starquake/voidmarch/internal/server"
	"github.com/starquake/voidmarch/internal/testutil"
)

func testFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html":   {Data: []byte("<!doctype html><title>Voidmarch</title>")},
		"js/main.js":   {Data: []byte("console.log('voidmarch')")},
		"css/site.css": {Data: []byte("body{}")},
	}
}

func newServer(t *testing.T, cfg *config.Config) *httptest.Server {
	t.Helper()

	srv := httptest.NewServer(
		New(
			slog.New(slog.DiscardHandler),
			cfg,
			testFS(),
			Services{Players: players.NewStore(testutil.OpenDB(t))},
		),
	)
	t.Cleanup(srv.Close)

	return srv
}

// response is a fully read HTTP response.
type response struct {
	status int
	header http.Header
	body   string
}

func get(t *testing.T, url string, header http.Header) response {
	t.Helper()

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("http.NewRequestWithContext() error = %v", err)
	}
	maps.Copy(req.Header, header)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s error = %v", url, err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}

	return response{status: resp.StatusCode, header: resp.Header, body: string(body)}
}

func TestNew_Routes(t *testing.T) {
	t.Parallel()

	srv := newServer(t, &config.Config{AppEnvironment: config.AppEnvironmentDevelopment})

	tests := []struct {
		path        string
		wantStatus  int
		wantType    string
		wantContain string
	}{
		{
			path:        "/",
			wantStatus:  http.StatusOK,
			wantType:    "text/html",
			wantContain: "<title>Voidmarch</title>",
		},
		{
			path:        "/static/js/main.js",
			wantStatus:  http.StatusOK,
			wantType:    "text/javascript",
			wantContain: "voidmarch",
		},
		{
			path:        "/static/css/site.css",
			wantStatus:  http.StatusOK,
			wantType:    "text/css",
			wantContain: "body",
		},
		{path: "/static/js/", wantStatus: http.StatusNotFound},
		{path: "/static/", wantStatus: http.StatusNotFound},
		{path: "/static/missing.js", wantStatus: http.StatusNotFound},
		{path: "/nope", wantStatus: http.StatusNotFound},
		{
			path:        "/healthz",
			wantStatus:  http.StatusOK,
			wantType:    "application/json",
			wantContain: `"ok"`,
		},
		{
			path:        "/version",
			wantStatus:  http.StatusOK,
			wantType:    "application/json",
			wantContain: `"env":"development"`,
		},
	}

	for _, tc := range tests {
		t.Run(tc.path, func(t *testing.T) {
			t.Parallel()

			resp := get(t, srv.URL+tc.path, nil)

			if got, want := resp.status, tc.wantStatus; got != want {
				t.Errorf("status = %d, want %d", got, want)
			}
			contentType := resp.header.Get("Content-Type")
			if got, want := contentType, tc.wantType; !strings.Contains(got, want) {
				t.Errorf("Content-Type = %q, should contain %q", got, want)
			}
			if got, want := resp.body, tc.wantContain; !strings.Contains(got, want) {
				t.Errorf("body = %q, should contain %q", got, want)
			}
		})
	}
}

func TestNew_ETag(t *testing.T) {
	t.Parallel()

	srv := newServer(t, &config.Config{AppEnvironment: config.AppEnvironmentProduction})

	resp := get(t, srv.URL+"/static/js/main.js", nil)
	etag := resp.header.Get("ETag")
	if etag == "" {
		t.Fatal("ETag header is empty")
	}
	if got, want := resp.header.Get("Cache-Control"), "no-cache"; got != want {
		t.Errorf("Cache-Control = %q, want %q", got, want)
	}

	resp = get(t, srv.URL+"/static/js/main.js", http.Header{"If-None-Match": {etag}})
	if got, want := resp.status, http.StatusNotModified; got != want {
		t.Errorf("status = %d, want %d", got, want)
	}
}

func TestNew_ETagFollowsDiskChanges(t *testing.T) {
	t.Parallel()

	fsys := testFS()
	files := NewStatic(fsys, false)
	handler := HandleStatic(files)

	etag := func() string {
		w := httptest.NewRecorder()
		handler.ServeHTTP(
			w,
			httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/js/main.js", nil),
		)

		return w.Header().Get("ETag")
	}

	before := etag()
	fsys["js/main.js"] = &fstest.MapFile{Data: []byte("console.log('changed')")}
	after := etag()

	if before == after {
		t.Errorf("ETag unchanged after the file changed: %q", before)
	}
}

func TestNew_InvalidPath(t *testing.T) {
	t.Parallel()

	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/../secret", nil)
	HandleStatic(NewStatic(testFS(), true)).ServeHTTP(w, req)

	if got, want := w.Code, http.StatusNotFound; got != want {
		t.Errorf("status = %d, want %d", got, want)
	}
}

func TestNew_SecurityHeaders(t *testing.T) {
	t.Parallel()

	tests := []struct {
		env      string
		wantHSTS bool
	}{
		{env: config.AppEnvironmentDevelopment, wantHSTS: false},
		{env: config.AppEnvironmentProduction, wantHSTS: true},
	}

	for _, tc := range tests {
		t.Run(tc.env, func(t *testing.T) {
			t.Parallel()

			srv := newServer(t, &config.Config{AppEnvironment: tc.env})
			resp := get(t, srv.URL+"/", nil)

			csp := resp.header.Get("Content-Security-Policy")
			if got, want := csp, "script-src 'self' 'wasm-unsafe-eval';"; !strings.Contains(
				got,
				want,
			) {
				t.Errorf("Content-Security-Policy = %q, should contain %q", got, want)
			}
			if got, want := resp.header.Get("X-Content-Type-Options"), "nosniff"; got != want {
				t.Errorf("X-Content-Type-Options = %q, want %q", got, want)
			}
			hasHSTS := resp.header.Get("Strict-Transport-Security") != ""
			if got, want := hasHSTS, tc.wantHSTS; got != want {
				t.Errorf("HSTS present = %t, want %t", got, want)
			}
		})
	}
}
