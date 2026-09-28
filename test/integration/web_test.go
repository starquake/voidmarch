package integration_test

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/starquake/voidmarch/internal/web"
)

func TestWebClient_Embedded(t *testing.T) {
	t.Parallel()

	baseURL := startServer(t, nil)

	tests := []struct {
		path        string
		wantType    string
		wantContain string
	}{
		{path: "/", wantType: "text/html", wantContain: `src="/static/wasm/wasm_exec.js"`},
		{path: "/static/css/style.css", wantType: "text/css"},
		{
			path:        "/static/js/main.js",
			wantType:    "text/javascript",
			wantContain: "./vendor/phaser.js",
		},
		{path: "/static/js/vendor/phaser.js", wantType: "text/javascript", wantContain: "Phaser"},
		{path: "/static/wasm/sim.wasm", wantType: "application/wasm", wantContain: "\x00asm"},
		{
			path:        "/static/wasm/wasm_exec.js",
			wantType:    "text/javascript",
			wantContain: "globalThis.Go = class",
		},
		{path: "/healthz", wantType: "application/json", wantContain: `"status":"ok"`},
		{path: "/version", wantType: "application/json", wantContain: `"env":"development"`},
	}

	for _, tc := range tests {
		t.Run(tc.path, func(t *testing.T) {
			t.Parallel()

			resp := get(t, baseURL+tc.path)

			if got, want := resp.status, http.StatusOK; got != want {
				t.Errorf("status = %d, want %d", got, want)
			}
			contentType := resp.header.Get("Content-Type")
			if got, want := contentType, tc.wantType; !strings.Contains(got, want) {
				t.Errorf("Content-Type = %q, should contain %q", got, want)
			}
			if got, want := resp.body, tc.wantContain; !strings.Contains(got, want) {
				t.Errorf("body should contain %q", want)
			}
		})
	}
}

func TestWebClient_NoDirectoryListing(t *testing.T) {
	t.Parallel()

	baseURL := startServer(t, nil)

	for _, path := range []string{"/static/", "/static/js/", "/static/js/vendor/"} {
		resp := get(t, baseURL+path)
		if got, want := resp.status, http.StatusNotFound; got != want {
			t.Errorf("GET %s status = %d, want %d", path, got, want)
		}
	}
}

func TestWebClient_WebDirOverride(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	index := filepath.Join(dir, "index.html")
	if err := os.WriteFile(index, []byte("from disk"), 0o600); err != nil {
		t.Fatalf("writing index.html: %v", err)
	}

	baseURL := startServer(t, map[string]string{"WEB_DIR": dir})

	resp := get(t, baseURL+"/")
	if got, want := resp.body, "from disk"; got != want {
		t.Errorf("body = %q, want %q", got, want)
	}
}

func TestWebClient_Audio(t *testing.T) {
	t.Parallel()

	baseURL := startServer(t, nil)

	static, err := web.Static()
	if err != nil {
		t.Fatalf("web.Static() error = %v", err)
	}

	for ext, wantType := range map[string]string{".ogg": "audio/ogg", ".mp3": "audio/mpeg"} {
		files, err := fs.Glob(static, "audio/*/*"+ext)
		if err != nil {
			t.Fatalf("fs.Glob() error = %v", err)
		}
		if len(files) == 0 {
			t.Fatalf("no %s audio embedded", ext)
		}
		for _, name := range files {
			resp := get(t, baseURL+"/static/"+name)
			if got, want := resp.status, http.StatusOK; got != want {
				t.Errorf("GET %s status = %d, want %d", name, got, want)
			}
			if got, want := resp.header.Get("Content-Type"), wantType; got != want {
				t.Errorf("GET %s Content-Type = %q, want %q", name, got, want)
			}
		}
	}
}

func TestWebClient_Assets(t *testing.T) {
	t.Parallel()

	baseURL := startServer(t, nil)

	static, err := web.Static()
	if err != nil {
		t.Fatalf("web.Static() error = %v", err)
	}
	pngs, err := fs.Glob(static, "assets/*/*.png")
	if err != nil {
		t.Fatalf("fs.Glob() error = %v", err)
	}
	if len(pngs) == 0 {
		t.Fatal("no PNG assets embedded")
	}

	for _, name := range pngs {
		resp := get(t, baseURL+"/static/"+name)
		if got, want := resp.status, http.StatusOK; got != want {
			t.Errorf("GET %s status = %d, want %d", name, got, want)
		}
		if got, want := resp.header.Get("Content-Type"), "image/png"; got != want {
			t.Errorf("GET %s Content-Type = %q, want %q", name, got, want)
		}
	}
}
