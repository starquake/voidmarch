package server

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"strings"
	"sync"
)

const etagBytes = 16

// staticFiles serves the web client with content-hash ETags, so browsers
// revalidate cheaply instead of downloading the Phaser bundle on every load.
type staticFiles struct {
	fsys       fs.FS
	cacheETags bool
	etags      sync.Map
}

func newStaticFiles(fsys fs.FS, cacheETags bool) *staticFiles {
	return &staticFiles{fsys: noDirFS{fsys}, cacheETags: cacheETags}
}

// serve writes the named file, or a 404 when it does not exist.
func (s *staticFiles) serve(w http.ResponseWriter, r *http.Request, name string) {
	if !fs.ValidPath(name) {
		http.NotFound(w, r)

		return
	}

	if tag, err := s.etag(name); err == nil {
		w.Header().Set("ETag", tag)
	}
	w.Header().Set("Cache-Control", "no-cache")
	//nolint:gosec // name passed fs.ValidPath above, and fsys is rooted.
	http.ServeFileFS(w, r, s.fsys, name)
}

// etag returns the quoted content hash of the named file.
func (s *staticFiles) etag(name string) (string, error) {
	if tag, ok := s.etags.Load(name); ok {
		if str, isString := tag.(string); isString {
			return str, nil
		}
	}

	f, err := s.fsys.Open(name)
	if err != nil {
		return "", fmt.Errorf("error opening %q: %w", name, err)
	}
	defer func() { _ = f.Close() }()

	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return "", fmt.Errorf("error hashing %q: %w", name, err)
	}

	tag := `"` + hex.EncodeToString(h.Sum(nil)[:etagBytes]) + `"`
	if s.cacheETags {
		s.etags.Store(name, tag)
	}

	return tag, nil
}

func handleIndex(files *staticFiles) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		files.serve(w, r, "index.html")
	})
}

func handleStatic(files *staticFiles) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		files.serve(w, r, strings.TrimPrefix(r.URL.Path, "/"))
	})
}

// noDirFS hides directories, so the file server never renders a listing.
type noDirFS struct {
	fs.FS
}

// errIsDir is returned when a directory is opened through noDirFS.
var errIsDir = errors.New("is a directory")

// Open opens the named file, failing with [fs.ErrNotExist] for directories.
func (n noDirFS) Open(name string) (fs.File, error) {
	f, err := n.FS.Open(name)
	if err != nil {
		return nil, fmt.Errorf("error opening %q: %w", name, err)
	}

	info, err := f.Stat()
	if err != nil {
		_ = f.Close()

		return nil, fmt.Errorf("error reading %q: %w", name, err)
	}
	if info.IsDir() {
		_ = f.Close()

		return nil, fmt.Errorf("%q: %w: %w", name, errIsDir, fs.ErrNotExist)
	}

	return f, nil
}
