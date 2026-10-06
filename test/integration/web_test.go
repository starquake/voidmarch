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
		{
			path:        "/static/js/entry.js",
			wantType:    "text/javascript",
			wantContain: `import("./main.js")`,
		},
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
		{path: "/static/manifest.json", wantType: "application/json", wantContain: `"fullscreen"`},
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

func TestWebClient_EntryModule(t *testing.T) {
	t.Parallel()

	baseURL := startServer(t, nil)

	index := get(t, baseURL+"/")
	script := `<script type="module" src="/static/js/entry.js">`
	if !strings.Contains(index.body, script) {
		t.Errorf("index.html should contain %q", script)
	}
	if got, notWant := index.body, "/static/js/main.js"; strings.Contains(got, notWant) {
		t.Errorf("index.html should not load %q: the entry module imports it", notWant)
	}

	// It names the vendor modules' URLs for their sizes, but never imports one.
	entry := get(t, baseURL+"/static/js/entry.js")
	for _, notWant := range []string{`"./vendor/phaser.js"`, `"./vendor/protobuf`} {
		if strings.Contains(entry.body, notWant) {
			t.Errorf("entry.js should not import %s", notWant)
		}
	}
	if got, want := entry.body, `"/static/js/vendor/phaser.js": `; !strings.Contains(got, want) {
		t.Errorf("entry.js should contain %q, Phaser's size for the loading bar", want)
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

func TestWebClient_Fonts(t *testing.T) {
	t.Parallel()

	baseURL := startServer(t, nil)

	for _, name := range []string{"orbitron.woff2", "exo2.woff2"} {
		resp := get(t, baseURL+"/static/fonts/"+name)
		if got, want := resp.status, http.StatusOK; got != want {
			t.Errorf("GET %s status = %d, want %d", name, got, want)
		}
		if got, want := resp.header.Get("Content-Type"), "font/woff2"; got != want {
			t.Errorf("GET %s Content-Type = %q, want %q", name, got, want)
		}
		if got, want := resp.body, "wOF2"; !strings.HasPrefix(got, want) {
			t.Errorf(
				"GET %s body starts %q, want the woff2 signature %q",
				name,
				got[:min(len(got), 4)],
				want,
			)
		}
	}
}
