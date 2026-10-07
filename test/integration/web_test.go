package integration_test

import (
	"compress/gzip"
	"io"
	"io/fs"
	"maps"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/starquake/voidmarch/internal/web"
)

// fetchRaw sends a request with header, and no Accept-Encoding beyond it, and
// reads the response body as sent.
func fetchRaw(t *testing.T, method, url string, header http.Header) response {
	t.Helper()

	req, err := http.NewRequestWithContext(t.Context(), method, url, nil)
	if err != nil {
		t.Fatalf("http.NewRequestWithContext() error = %v", err)
	}
	maps.Copy(req.Header, header)

	transport := &http.Transport{DisableCompression: true}
	defer transport.CloseIdleConnections()

	resp, err := (&http.Client{Transport: transport}).Do(req)
	if err != nil {
		t.Fatalf("%s %s error = %v", method, url, err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}

	return response{status: resp.StatusCode, header: resp.Header, body: string(body)}
}

// embedded returns the embedded client file name.
func embedded(t *testing.T, name string) string {
	t.Helper()

	static, err := web.Static()
	if err != nil {
		t.Fatalf("web.Static() error = %v", err)
	}
	data, err := fs.ReadFile(static, name)
	if err != nil {
		t.Fatalf("fs.ReadFile(%q) error = %v", name, err)
	}

	return string(data)
}

func gunzip(t *testing.T, body string) string {
	t.Helper()

	zr, err := gzip.NewReader(strings.NewReader(body))
	if err != nil {
		t.Fatalf("gzip.NewReader() error = %v", err)
	}
	plain, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("reading gzip body: %v", err)
	}

	return string(plain)
}

func TestWebClient_Gzip(t *testing.T) {
	t.Parallel()

	baseURL := startServer(t, nil)

	const js = "text/javascript; charset=utf-8"
	tests := []struct {
		path     string
		file     string
		wantType string
	}{
		{path: "/", file: "index.html", wantType: "text/html; charset=utf-8"},
		{path: "/static/js/entry.js", file: "js/entry.js", wantType: js},
		{path: "/static/js/main.js", file: "js/main.js", wantType: js},
		{path: "/static/js/vendor/phaser.js", file: "js/vendor/phaser.js", wantType: js},
		{path: "/static/css/style.css", file: "css/style.css", wantType: "text/css; charset=utf-8"},
		{path: "/static/wasm/sim.wasm", file: "wasm/sim.wasm", wantType: "application/wasm"},
		{path: "/static/wasm/wasm_exec.js", file: "wasm/wasm_exec.js", wantType: js},
		{path: "/static/manifest.json", file: "manifest.json", wantType: "application/json"},
	}

	for _, tc := range tests {
		t.Run(tc.path, func(t *testing.T) {
			t.Parallel()

			file := embedded(t, tc.file)
			gzipped := fetchRaw(t, http.MethodGet, baseURL+tc.path, http.Header{
				"Accept-Encoding": {"gzip, deflate, br, zstd"},
			})
			plain := fetchRaw(t, http.MethodGet, baseURL+tc.path, nil)

			for _, resp := range []response{gzipped, plain} {
				if got, want := resp.status, http.StatusOK; got != want {
					t.Fatalf("status = %d, want %d", got, want)
				}
				if got, want := resp.header.Get("Content-Type"), tc.wantType; got != want {
					t.Errorf("Content-Type = %q, want %q", got, want)
				}
				if got, want := resp.header.Get("Vary"), "Accept-Encoding"; got != want {
					t.Errorf("Vary = %q, want %q", got, want)
				}
				if got, want := resp.header.Get("Cache-Control"), "no-cache"; got != want {
					t.Errorf("Cache-Control = %q, want %q", got, want)
				}
				wantLength := strconv.Itoa(len(resp.body))
				if got, want := resp.header.Get("Content-Length"), wantLength; got != want {
					t.Errorf("Content-Length = %q, want %q", got, want)
				}
			}

			if got, want := gzipped.header.Get("Content-Encoding"), "gzip"; got != want {
				t.Errorf("gzip Content-Encoding = %q, want %q", got, want)
			}
			if got, want := len(gzipped.body), len(file); got >= want {
				t.Errorf("gzip body is %d bytes, should be under the file's %d", got, want)
			}
			if gunzip(t, gzipped.body) != file {
				t.Error("gunzipped body differs from the embedded file")
			}
			if got := plain.header.Get("Content-Encoding"); got != "" {
				t.Errorf("plain Content-Encoding = %q, want none", got)
			}
			if plain.body != file {
				t.Error("plain body differs from the embedded file")
			}
			if got, want := gzipped.header.Get("ETag"), plain.header.Get("ETag"); got == want {
				t.Errorf("gzip and plain ETags are both %q", got)
			}
		})
	}
}

func TestWebClient_GzipNotModified(t *testing.T) {
	t.Parallel()

	baseURL := startServer(t, nil)
	url := baseURL + "/static/js/main.js"
	gzipTag := fetchRaw(t, http.MethodGet, url, http.Header{"Accept-Encoding": {"gzip"}}).
		header.Get("ETag")
	plainTag := fetchRaw(t, http.MethodGet, url, nil).header.Get("ETag")

	tests := []struct {
		name        string
		accept      string
		ifNoneMatch string
		wantStatus  int
	}{
		{name: "gzip", accept: "gzip", ifNoneMatch: gzipTag, wantStatus: http.StatusNotModified},
		{
			name:        "plain",
			accept:      "identity",
			ifNoneMatch: plainTag,
			wantStatus:  http.StatusNotModified,
		},
		{
			name:        "gzip with the plain tag",
			accept:      "gzip",
			ifNoneMatch: plainTag,
			wantStatus:  http.StatusOK,
		},
		{
			name:        "plain with the gzip tag",
			accept:      "identity",
			ifNoneMatch: gzipTag,
			wantStatus:  http.StatusOK,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			resp := fetchRaw(t, http.MethodGet, url, http.Header{
				"Accept-Encoding": {tc.accept},
				"If-None-Match":   {tc.ifNoneMatch},
			})

			if got, want := resp.status, tc.wantStatus; got != want {
				t.Errorf("status = %d, want %d", got, want)
			}
			if got, want := resp.header.Get("Vary"), "Accept-Encoding"; got != want {
				t.Errorf("Vary = %q, want %q", got, want)
			}
		})
	}
}

func TestWebClient_GzipHeadAndRange(t *testing.T) {
	t.Parallel()

	baseURL := startServer(t, nil)
	url := baseURL + "/static/js/vendor/phaser.js"
	gzipped := http.Header{"Accept-Encoding": {"gzip"}}
	full := fetchRaw(t, http.MethodGet, url, gzipped)

	head := fetchRaw(t, http.MethodHead, url, gzipped)
	if got, want := head.header.Get("Content-Length"), strconv.Itoa(len(full.body)); got != want {
		t.Errorf("HEAD Content-Length = %q, want %q, the gzip body's", got, want)
	}
	if got, want := head.header.Get("Content-Encoding"), "gzip"; got != want {
		t.Errorf("HEAD Content-Encoding = %q, want %q", got, want)
	}

	ranged := fetchRaw(t, http.MethodGet, url, http.Header{
		"Accept-Encoding": {"gzip"},
		"Range":           {"bytes=0-1"},
	})
	if got, want := ranged.status, http.StatusPartialContent; got != want {
		t.Fatalf("Range status = %d, want %d", got, want)
	}
	if got, want := ranged.body, "\x1f\x8b"; got != want {
		t.Errorf("Range body = %q, want the gzip magic %q", got, want)
	}
}

func TestWebClient_NotCompressed(t *testing.T) {
	t.Parallel()

	baseURL := startServer(t, nil)

	static, err := web.Static()
	if err != nil {
		t.Fatalf("web.Static() error = %v", err)
	}
	patterns := []string{"assets/*/*.png", "audio/*/*.ogg", "fonts/*.woff2"}
	names := make([]string, 0, len(patterns))
	for _, pattern := range patterns {
		matches, err := fs.Glob(static, pattern)
		if err != nil {
			t.Fatalf("fs.Glob(%q) error = %v", pattern, err)
		}
		if len(matches) == 0 {
			t.Fatalf("nothing embedded matches %q", pattern)
		}
		names = append(names, matches[0])
	}

	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			resp := fetchRaw(t, http.MethodGet, baseURL+"/static/"+name, http.Header{
				"Accept-Encoding": {"gzip"},
			})

			if got := resp.header.Get("Content-Encoding"); got != "" {
				t.Errorf("Content-Encoding = %q, want none", got)
			}
			if got := resp.header.Get("Vary"); got != "" {
				t.Errorf("Vary = %q, want none", got)
			}
			if resp.body != embedded(t, name) {
				t.Error("body differs from the embedded file")
			}
		})
	}
}

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
