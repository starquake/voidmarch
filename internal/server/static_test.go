package server_test

import (
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"maps"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"

	. "github.com/starquake/voidmarch/internal/server"
)

// statFailFS returns files whose Stat always fails.
type statFailFS struct{}

type statFailFile struct{ fs.File }

var errStat = errors.New("stat failed")

func (statFailFS) Open(string) (fs.File, error) { return statFailFile{}, nil }
func (statFailFile) Stat() (fs.FileInfo, error) { return nil, errStat }
func (statFailFile) Close() error               { return nil }

func TestNoDirFS_Open(t *testing.T) {
	t.Parallel()

	fsys := NoDirFS{FS: fstest.MapFS{"js/main.js": {Data: []byte("x")}}}

	tests := []struct {
		name    string
		wantErr error
	}{
		{name: "js/main.js", wantErr: nil},
		{name: "js", wantErr: ErrIsDir},
		{name: ".", wantErr: fs.ErrNotExist},
		{name: "missing.js", wantErr: fs.ErrNotExist},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			f, err := fsys.Open(tc.name)
			if got, want := err, tc.wantErr; !errors.Is(got, want) {
				t.Errorf("Open(%q) error = %v, want %v", tc.name, got, want)
			}
			if err == nil {
				_ = f.Close()
			}
		})
	}
}

func TestNoDirFS_OpenStatError(t *testing.T) {
	t.Parallel()

	_, err := NoDirFS{FS: statFailFS{}}.Open("x")

	if got, want := err, errStat; !errors.Is(got, want) {
		t.Errorf("Open() error = %v, want %v", got, want)
	}
}

func TestAcceptsGzip(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		acceptEncoding []string
		want           bool
	}{
		{name: "none", acceptEncoding: nil, want: false},
		{name: "empty", acceptEncoding: []string{""}, want: false},
		{name: "identity", acceptEncoding: []string{"identity"}, want: false},
		{name: "gzip", acceptEncoding: []string{"gzip"}, want: true},
		{name: "a browser's", acceptEncoding: []string{"gzip, deflate, br, zstd"}, want: true},
		{name: "upper case", acceptEncoding: []string{"GZIP"}, want: true},
		{name: "spaced", acceptEncoding: []string{"br ,  gzip ; q=0.5"}, want: true},
		{name: "refused", acceptEncoding: []string{"gzip;q=0"}, want: false},
		{name: "refused, zero padded", acceptEncoding: []string{"gzip;q=0.000"}, want: false},
		{name: "a bad q", acceptEncoding: []string{"gzip;q=x"}, want: false},
		{name: "anything", acceptEncoding: []string{"*"}, want: true},
		{name: "anything but gzip", acceptEncoding: []string{"*, gzip;q=0"}, want: false},
		{name: "nothing else", acceptEncoding: []string{"gzip, *;q=0"}, want: true},
		{name: "two headers", acceptEncoding: []string{"br", "gzip"}, want: true},
		{name: "x-gzip", acceptEncoding: []string{"x-gzip"}, want: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			header := http.Header{}
			if tc.acceptEncoding != nil {
				header["Accept-Encoding"] = tc.acceptEncoding
			}

			if got, want := AcceptsGzip(header), tc.want; got != want {
				t.Errorf("AcceptsGzip(%q) = %t, want %t", tc.acceptEncoding, got, want)
			}
		})
	}
}

// script is large and repetitive enough that gzip shrinks it.
var script = []byte(strings.Repeat("console.log('voidmarch');\n", 64))

func gzipFS() fstest.MapFS {
	return fstest.MapFS{
		"page.html":     {Data: script},
		"js/main.js":    {Data: script},
		"wasm/sim.wasm": {Data: script},
		"img/ship.png":  {Data: script},
		"css/tiny.css":  {Data: []byte("body{}")},
	}
}

// serveStatic runs one request through handler.
func serveStatic(
	t *testing.T,
	handler http.Handler,
	method, path string,
	header http.Header,
) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequestWithContext(t.Context(), method, path, nil)
	maps.Copy(req.Header, header)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	return w
}

func gunzip(t *testing.T, body []byte) []byte {
	t.Helper()

	zr, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("gzip.NewReader() error = %v", err)
	}
	plain, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("reading gzip body: %v", err)
	}

	return plain
}

func TestHandleStatic_Gzip(t *testing.T) {
	t.Parallel()

	tests := []struct {
		path     string
		wantType string
	}{
		{path: "/page.html", wantType: "text/html; charset=utf-8"},
		{path: "/js/main.js", wantType: "text/javascript; charset=utf-8"},
		{path: "/wasm/sim.wasm", wantType: "application/wasm"},
	}

	for _, tc := range tests {
		t.Run(tc.path, func(t *testing.T) {
			t.Parallel()

			handler := HandleStatic(NewStatic(gzipFS(), true))
			w := serveStatic(t, handler, http.MethodGet, tc.path, http.Header{
				"Accept-Encoding": {"gzip, deflate, br"},
			})

			if got, want := w.Code, http.StatusOK; got != want {
				t.Fatalf("status = %d, want %d", got, want)
			}
			if got, want := w.Header().Get("Content-Encoding"), "gzip"; got != want {
				t.Errorf("Content-Encoding = %q, want %q", got, want)
			}
			if got, want := w.Header().Get("Content-Type"), tc.wantType; got != want {
				t.Errorf("Content-Type = %q, want %q", got, want)
			}
			if got, want := w.Header().Get("Vary"), "Accept-Encoding"; got != want {
				t.Errorf("Vary = %q, want %q", got, want)
			}
			if got, want := w.Header().Get("Cache-Control"), "no-cache"; got != want {
				t.Errorf("Cache-Control = %q, want %q", got, want)
			}
			wantLength := strconv.Itoa(w.Body.Len())
			if got, want := w.Header().Get("Content-Length"), wantLength; got != want {
				t.Errorf("Content-Length = %q, want %q, the gzip body's", got, want)
			}
			if got, want := w.Header().Get("ETag"), `-gz"`; !strings.HasSuffix(got, want) {
				t.Errorf("ETag = %q, should end with %q", got, want)
			}
			if got, want := w.Body.Len(), len(script); got >= want {
				t.Errorf("gzip body is %d bytes, should be under the file's %d", got, want)
			}
			if got, want := gunzip(t, w.Body.Bytes()), script; !bytes.Equal(got, want) {
				t.Error("gunzipped body differs from the file")
			}
		})
	}
}

func TestHandleStatic_Plain(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		path           string
		acceptEncoding []string
		wantVary       string
	}{
		{name: "no Accept-Encoding", path: "/js/main.js", wantVary: "Accept-Encoding"},
		{
			name:           "identity",
			path:           "/js/main.js",
			acceptEncoding: []string{"identity"},
			wantVary:       "Accept-Encoding",
		},
		{
			name:           "gzip refused",
			path:           "/js/main.js",
			acceptEncoding: []string{"gzip;q=0, br"},
			wantVary:       "Accept-Encoding",
		},
		{name: "an image", path: "/img/ship.png", acceptEncoding: []string{"gzip"}},
		{
			name:           "too small to shrink",
			path:           "/css/tiny.css",
			acceptEncoding: []string{"gzip"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			fsys := gzipFS()
			header := http.Header{}
			if tc.acceptEncoding != nil {
				header["Accept-Encoding"] = tc.acceptEncoding
			}
			handler := HandleStatic(NewStatic(fsys, true))
			w := serveStatic(t, handler, http.MethodGet, tc.path, header)

			if got, want := w.Code, http.StatusOK; got != want {
				t.Fatalf("status = %d, want %d", got, want)
			}
			if got := w.Header().Get("Content-Encoding"); got != "" {
				t.Errorf("Content-Encoding = %q, want none", got)
			}
			if got, want := w.Header().Get("Vary"), tc.wantVary; got != want {
				t.Errorf("Vary = %q, want %q", got, want)
			}
			if got, notWant := w.Header().Get("ETag"), `-gz"`; got == "" ||
				strings.HasSuffix(got, notWant) {
				t.Errorf("ETag = %q, want the plain content hash", got)
			}
			want := fsys[strings.TrimPrefix(tc.path, "/")].Data
			if got := w.Body.Bytes(); !bytes.Equal(got, want) {
				t.Errorf("body = %q, want the file", got)
			}
		})
	}
}

func TestHandleStatic_GzipConditional(t *testing.T) {
	t.Parallel()

	handler := HandleStatic(NewStatic(gzipFS(), true))
	gzipped := http.Header{"Accept-Encoding": {"gzip"}}
	gzipTag := serveStatic(t, handler, http.MethodGet, "/js/main.js", gzipped).Header().Get("ETag")
	plainTag := serveStatic(t, handler, http.MethodGet, "/js/main.js", nil).Header().Get("ETag")

	if gzipTag == plainTag {
		t.Fatalf("gzip and plain ETags are both %q", gzipTag)
	}

	tests := []struct {
		name        string
		accept      string
		ifNoneMatch string
		wantStatus  int
	}{
		{
			name:        "gzip, gzip tag",
			accept:      "gzip",
			ifNoneMatch: gzipTag,
			wantStatus:  http.StatusNotModified,
		},
		{
			name:        "plain, plain tag",
			accept:      "identity",
			ifNoneMatch: plainTag,
			wantStatus:  http.StatusNotModified,
		},
		{name: "gzip, plain tag", accept: "gzip", ifNoneMatch: plainTag, wantStatus: http.StatusOK},
		{
			name:        "plain, gzip tag",
			accept:      "identity",
			ifNoneMatch: gzipTag,
			wantStatus:  http.StatusOK,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			w := serveStatic(t, handler, http.MethodGet, "/js/main.js", http.Header{
				"Accept-Encoding": {tc.accept},
				"If-None-Match":   {tc.ifNoneMatch},
			})

			if got, want := w.Code, tc.wantStatus; got != want {
				t.Errorf("status = %d, want %d", got, want)
			}
			if got, want := w.Header().Get("Vary"), "Accept-Encoding"; got != want {
				t.Errorf("Vary = %q, want %q", got, want)
			}
		})
	}
}

func TestHandleStatic_GzipHead(t *testing.T) {
	t.Parallel()

	handler := HandleStatic(NewStatic(gzipFS(), true))
	gzipped := http.Header{"Accept-Encoding": {"gzip"}}
	full := serveStatic(t, handler, http.MethodGet, "/js/main.js", gzipped).Body.Bytes()

	head := serveStatic(t, handler, http.MethodHead, "/js/main.js", gzipped)

	if got, want := head.Header().Get("Content-Length"), strconv.Itoa(len(full)); got != want {
		t.Errorf("Content-Length = %q, want %q", got, want)
	}
	if got, want := head.Header().Get("Content-Encoding"), "gzip"; got != want {
		t.Errorf("Content-Encoding = %q, want %q", got, want)
	}
	if got := head.Body.Len(); got != 0 {
		t.Errorf("body is %d bytes, want none", got)
	}
}

func TestHandleStatic_GzipRange(t *testing.T) {
	t.Parallel()

	handler := HandleStatic(NewStatic(gzipFS(), true))
	full := serveStatic(t, handler, http.MethodGet, "/js/main.js", http.Header{
		"Accept-Encoding": {"gzip"},
	}).Body.Bytes()

	ranged := serveStatic(t, handler, http.MethodGet, "/js/main.js", http.Header{
		"Accept-Encoding": {"gzip"},
		"Range":           {"bytes=0-9"},
	})

	if got, want := ranged.Code, http.StatusPartialContent; got != want {
		t.Fatalf("status = %d, want %d", got, want)
	}
	wantRange := fmt.Sprintf("bytes 0-9/%d", len(full))
	if got, want := ranged.Header().Get("Content-Range"), wantRange; got != want {
		t.Errorf("Content-Range = %q, want %q", got, want)
	}
	if got, want := ranged.Header().Get("Content-Encoding"), "gzip"; got != want {
		t.Errorf("Content-Encoding = %q, want %q", got, want)
	}
	if got, want := ranged.Body.Bytes(), full[:10]; !bytes.Equal(got, want) {
		t.Errorf("body = %x, want %x", got, want)
	}

	unsatisfiable := serveStatic(t, handler, http.MethodGet, "/js/main.js", http.Header{
		"Accept-Encoding": {"gzip"},
		"Range":           {fmt.Sprintf("bytes=%d-", len(full))},
	})

	if got, want := unsatisfiable.Code, http.StatusRequestedRangeNotSatisfiable; got != want {
		t.Errorf("past-the-end status = %d, want %d", got, want)
	}
	if got := unsatisfiable.Header().Get("Content-Encoding"); got != "" {
		t.Errorf("past-the-end Content-Encoding = %q, want none", got)
	}
}

func TestHandleStatic_GzipFollowsDiskChanges(t *testing.T) {
	t.Parallel()

	fsys := gzipFS()
	handler := HandleStatic(NewStatic(fsys, false))
	gzipped := http.Header{"Accept-Encoding": {"gzip"}}

	before := serveStatic(t, handler, http.MethodGet, "/js/main.js", gzipped)
	changed := []byte(strings.Repeat("console.log('changed');\n", 64))
	fsys["js/main.js"] = &fstest.MapFile{Data: changed}
	after := serveStatic(t, handler, http.MethodGet, "/js/main.js", gzipped)

	if got := after.Header().Get("ETag"); got == before.Header().Get("ETag") {
		t.Errorf("gzip ETag unchanged after the file changed: %q", got)
	}
	if got, want := gunzip(t, after.Body.Bytes()), changed; !bytes.Equal(got, want) {
		t.Errorf("gunzipped body = %q, want the changed file", got)
	}
}

// forGood is the Cache-Control of a file the browser never asks about again.
const forGood = "public, max-age=31536000, immutable"

// page links the files of gzipFS the way index.html does.
const page = `<link rel="stylesheet" href="/static/css/tiny.css">` +
	`<script src="/static/js/main.js"></script><a href="/elsewhere">`

// buildFS is gzipFS with a page.
func buildFS() fstest.MapFS {
	fsys := gzipFS()
	fsys["index.html"] = &fstest.MapFile{Data: []byte(page)}

	return fsys
}

// newBuildRoutes serves fsys's page and its files under a build's prefix, as
// the server does, and its files unversioned from the root.
func newBuildRoutes(fsys fs.FS, fixed bool) http.Handler {
	files := NewStatic(fsys, fixed)
	mux := http.NewServeMux()
	mux.Handle("GET /{$}", HandleIndex(files))
	mux.Handle("GET /static/v/{build}/{file...}", HandleBuild(files))
	mux.Handle("GET /", HandleStatic(files))

	return mux
}

func runningBuild(t *testing.T, fsys fs.FS) string {
	t.Helper()

	build, err := BuildID(fsys)
	if err != nil {
		t.Fatalf("BuildID() error = %v", err)
	}

	return build
}

func TestBuildID(t *testing.T) {
	t.Parallel()

	build := runningBuild(t, buildFS())
	if got, want := len(build), 16; got != want {
		t.Errorf("BuildID() = %q, want %d hex digits", build, want)
	}
	if got := runningBuild(t, buildFS()); got != build {
		t.Errorf("BuildID() of the same files = %q, want %q", got, build)
	}

	changed := buildFS()
	changed["img/ship.png"] = &fstest.MapFile{Data: []byte("another ship")}
	moved := buildFS()
	moved["img/ship2.png"] = moved["img/ship.png"]
	delete(moved, "img/ship.png")
	added := buildFS()
	added["audio/new.ogg"] = &fstest.MapFile{Data: []byte("new")}

	for name, fsys := range map[string]fstest.MapFS{"changed": changed, "moved": moved, "added": added} {
		if got := runningBuild(t, fsys); got == build {
			t.Errorf("BuildID() with a file %s = %q, the same as before", name, got)
		}
	}
}

// walkFailFS opens its files but cannot list them.
type walkFailFS struct{ fstest.MapFS }

var errWalk = errors.New("walk failed")

func (walkFailFS) ReadDir(string) ([]fs.DirEntry, error) { return nil, errWalk }

func TestBuildID_Error(t *testing.T) {
	t.Parallel()

	_, err := BuildID(walkFailFS{buildFS()})

	if got, want := err, errWalk; !errors.Is(got, want) {
		t.Errorf("BuildID() error = %v, want %v", got, want)
	}
}

func TestHandleStatic_PageLinksTheBuild(t *testing.T) {
	t.Parallel()

	fsys := buildFS()
	prefix := "/static/v/" + runningBuild(t, fsys) + "/"
	wantBody := `<link rel="stylesheet" href="` + prefix + `css/tiny.css">` +
		`<script src="` + prefix + `js/main.js"></script><a href="/elsewhere">`

	for _, fixed := range []bool{true, false} {
		t.Run(fmt.Sprintf("fixed %t", fixed), func(t *testing.T) {
			t.Parallel()

			handler := newBuildRoutes(fsys, fixed)
			w := serveStatic(t, handler, http.MethodGet, "/", nil)

			if got, want := w.Code, http.StatusOK; got != want {
				t.Fatalf("status = %d, want %d", got, want)
			}
			if got, want := w.Body.String(), wantBody; got != want {
				t.Errorf("body = %q, want %q", got, want)
			}
			if got, want := w.Header().Get("Cache-Control"), "no-cache"; got != want {
				t.Errorf("Cache-Control = %q, want %q", got, want)
			}
			wantLength := strconv.Itoa(len(wantBody))
			if got, want := w.Header().Get("Content-Length"), wantLength; got != want {
				t.Errorf("Content-Length = %q, want %q", got, want)
			}

			again := serveStatic(t, handler, http.MethodGet, "/", http.Header{
				"If-None-Match": {w.Header().Get("ETag")},
			})
			if got, want := again.Code, http.StatusNotModified; got != want {
				t.Errorf("revalidated status = %d, want %d", got, want)
			}
		})
	}
}

func TestHandleStatic_PageWithoutABuild(t *testing.T) {
	t.Parallel()

	w := serveStatic(t, newBuildRoutes(walkFailFS{buildFS()}, true), http.MethodGet, "/", nil)

	if got, want := w.Code, http.StatusOK; got != want {
		t.Fatalf("status = %d, want %d", got, want)
	}
	if got, want := w.Body.String(), page; got != want {
		t.Errorf("body = %q, want the page as it is, %q", got, want)
	}
	if got, want := w.Header().Get("Cache-Control"), "no-cache"; got != want {
		t.Errorf("Cache-Control = %q, want %q", got, want)
	}
}

func TestHandleBuild(t *testing.T) {
	t.Parallel()

	build := runningBuild(t, buildFS())
	stale := strings.Repeat("0", len(build))

	tests := []struct {
		name       string
		fixed      bool
		path       string
		accept     string
		wantStatus int
		wantCache  string
		wantVary   string
		// wantFile is the file the body is, gunzipped when gzipped.
		wantFile     string
		wantEncoding string
	}{
		{
			name:         "the running build, gzipped",
			fixed:        true,
			path:         "/static/v/" + build + "/js/main.js",
			accept:       "gzip",
			wantStatus:   http.StatusOK,
			wantCache:    forGood,
			wantVary:     "Accept-Encoding",
			wantFile:     "js/main.js",
			wantEncoding: "gzip",
		},
		{
			name:       "the running build, plain",
			fixed:      true,
			path:       "/static/v/" + build + "/js/main.js",
			wantStatus: http.StatusOK,
			wantCache:  forGood,
			wantVary:   "Accept-Encoding",
			wantFile:   "js/main.js",
		},
		{
			name:       "the running build, an image",
			fixed:      true,
			path:       "/static/v/" + build + "/img/ship.png",
			accept:     "gzip",
			wantStatus: http.StatusOK,
			wantCache:  forGood,
			wantFile:   "img/ship.png",
		},
		{
			name:         "an older build",
			fixed:        true,
			path:         "/static/v/" + stale + "/js/main.js",
			accept:       "gzip",
			wantStatus:   http.StatusOK,
			wantCache:    "no-cache",
			wantVary:     "Accept-Encoding",
			wantFile:     "js/main.js",
			wantEncoding: "gzip",
		},
		{
			name:       "unversioned",
			fixed:      true,
			path:       "/js/main.js",
			wantStatus: http.StatusOK,
			wantCache:  "no-cache",
			wantVary:   "Accept-Encoding",
			wantFile:   "js/main.js",
		},
		{
			name:       "from disk",
			path:       "/static/v/" + build + "/js/main.js",
			wantStatus: http.StatusOK,
			wantCache:  "no-cache",
			wantVary:   "Accept-Encoding",
			wantFile:   "js/main.js",
		},
		{
			name:       "missing",
			fixed:      true,
			path:       "/static/v/" + build + "/js/missing.js",
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "a directory",
			fixed:      true,
			path:       "/static/v/" + build + "/js",
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "no file",
			fixed:      true,
			path:       "/static/v/" + build + "/",
			wantStatus: http.StatusNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			fsys := buildFS()
			header := http.Header{}
			if tc.accept != "" {
				header.Set("Accept-Encoding", tc.accept)
			}
			w := serveStatic(t, newBuildRoutes(fsys, tc.fixed), http.MethodGet, tc.path, header)

			if got, want := w.Code, tc.wantStatus; got != want {
				t.Fatalf("status = %d, want %d", got, want)
			}
			if got, want := w.Header().Get("Cache-Control"), tc.wantCache; got != want {
				t.Errorf("Cache-Control = %q, want %q", got, want)
			}
			if got, want := w.Header().Get("Vary"), tc.wantVary; got != want {
				t.Errorf("Vary = %q, want %q", got, want)
			}
			if got, want := w.Header().Get("Content-Encoding"), tc.wantEncoding; got != want {
				t.Errorf("Content-Encoding = %q, want %q", got, want)
			}
			if tc.wantFile == "" {
				return
			}
			body := w.Body.Bytes()
			if tc.wantEncoding == "gzip" {
				body = gunzip(t, body)
			}
			if got, want := body, fsys[tc.wantFile].Data; !bytes.Equal(got, want) {
				t.Errorf("body = %q, want %s", got, tc.wantFile)
			}
		})
	}
}

func TestHandleBuild_Revalidated(t *testing.T) {
	t.Parallel()

	handler := newBuildRoutes(buildFS(), true)
	path := "/static/v/" + runningBuild(t, buildFS()) + "/js/main.js"
	gzipped := http.Header{"Accept-Encoding": {"gzip"}}
	etag := serveStatic(t, handler, http.MethodGet, path, gzipped).Header().Get("ETag")

	w := serveStatic(t, handler, http.MethodGet, path, http.Header{
		"Accept-Encoding": {"gzip"},
		"If-None-Match":   {etag},
	})

	if got, want := w.Code, http.StatusNotModified; got != want {
		t.Errorf("status = %d, want %d", got, want)
	}
	if got, want := etag, `-gz"`; !strings.HasSuffix(got, want) {
		t.Errorf("ETag = %q, should end with %q", got, want)
	}
	if got, want := w.Header().Get("Cache-Control"), forGood; got != want {
		t.Errorf("Cache-Control = %q, want %q", got, want)
	}
}
