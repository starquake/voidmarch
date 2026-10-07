package server

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	etagBytes = 16
	// buildBytes is how much of the hash over every file names a build.
	buildBytes = 8
	// unlisted is the quality of a coding Accept-Encoding does not name.
	unlisted    = -1.0
	float64Bits = 64
)

// compressible reports whether the named file is worth gzipping; images,
// audio and fonts are compressed already.
func compressible(name string) bool {
	switch path.Ext(name) {
	case ".css", ".html", ".js", ".json", ".wasm":
		return true
	default:
		return false
	}
}

// The Cache-Control values the files are served with.
const (
	// revalidate is for a URL whose file can change: the browser asks first.
	revalidate = "no-cache"
	// forGood is for a URL of the running build, whose files never change.
	forGood = "public, max-age=31536000, immutable"
)

// indexFile is the page, whose links name the running build.
const indexFile = "index.html"

// staticFiles serves the web client. Under /static/v/<build>/ the running
// build's files are cached for good (#238); everything else, index.html
// included, revalidates cheaply against a content-hash ETag. It gzips the
// text and wasm for browsers that accept it.
type staticFiles struct {
	fsys  fs.FS
	fixed bool
	info  sync.Map
	build func() (string, error)
}

// fileInfo is what serving a file takes beyond the file itself.
type fileInfo struct {
	// hash is the hex content hash the ETags are made of.
	hash    string
	modTime time.Time
	// body is what is served in place of the file, when that differs from it.
	body []byte
	// gzipped is the file gzipped, or nil when that would not shrink it.
	gzipped []byte
}

// newStaticFiles serves fsys. fixed is for files that never change, the
// embedded ones: each file's hash and gzip are kept once made, and the running
// build's URLs are cached for good. Files that can change under a running
// server always revalidate, so the build is named once and never refreshed.
func newStaticFiles(fsys fs.FS, fixed bool) *staticFiles {
	registerTypes()

	return &staticFiles{
		fsys:  noDirFS{fsys},
		fixed: fixed,
		build: sync.OnceValues(func() (string, error) { return buildID(fsys) }),
	}
}

// buildID names the files in fsys as they are: a hash over every file's name
// and content, so it changes whenever any of them does, and only then.
func buildID(fsys fs.FS) (string, error) {
	h := sha256.New()
	err := fs.WalkDir(fsys, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return fmt.Errorf("error walking %q: %w", name, err)
		}
		if entry.IsDir() {
			return nil
		}
		data, err := fs.ReadFile(fsys, name)
		if err != nil {
			return fmt.Errorf("error reading %q: %w", name, err)
		}
		sum := sha256.Sum256(data)
		_, _ = h.Write([]byte(name + "\x00"))
		_, _ = h.Write(sum[:])

		return nil
	})
	if err != nil {
		return "", fmt.Errorf("error hashing the files: %w", err)
	}

	return hex.EncodeToString(h.Sum(nil)[:buildBytes]), nil
}

// buildPrefix is where a build's files are served.
func buildPrefix(build string) string {
	return "/static/v/" + build + "/"
}

// linkBuild points the page's /static/ links at the running build, so what
// they load, and what that loads by a relative URL, is cached for good.
func (s *staticFiles) linkBuild(page []byte) ([]byte, error) {
	build, err := s.build()
	if err != nil {
		return nil, fmt.Errorf("error naming the build: %w", err)
	}

	return bytes.ReplaceAll(page, []byte(`="/static/`), []byte(`="`+buildPrefix(build))), nil
}

// cachedForGood reports whether a URL naming build is never to be asked
// about again: it names the running build, of files that never change. An
// older build's URL, from a page open across a deploy, gets today's file to
// revalidate.
func (s *staticFiles) cachedForGood(build string) bool {
	if !s.fixed || build == "" {
		return false
	}
	running, err := s.build()

	return err == nil && build == running
}

// registerTypes adds the audio and font types missing from Go's built-in
// table; the distroless image has no system MIME database to fall back on.
func registerTypes() {
	_ = mime.AddExtensionType(".ogg", "audio/ogg")
	_ = mime.AddExtensionType(".mp3", "audio/mpeg")
	_ = mime.AddExtensionType(".woff2", "font/woff2")
}

// serve writes the named file, gzipped when it pays and the request accepts
// it, or a 404 when it does not exist. build is the build its URL names, or
// empty for an unversioned URL.
func (s *staticFiles) serve(w http.ResponseWriter, r *http.Request, name, build string) {
	if !fs.ValidPath(name) {
		http.NotFound(w, r)

		return
	}

	w.Header().Set("Cache-Control", revalidate)
	info, err := s.fileInfo(name)
	if err != nil {
		// Its error page, a 404 for a missing file or a directory, or else
		// the file as it is.
		//nolint:gosec // name passed fs.ValidPath above, and fsys is rooted.
		http.ServeFileFS(w, r, s.fsys, name)

		return
	}
	if s.cachedForGood(build) {
		w.Header().Set("Cache-Control", forGood)
	}

	if info.gzipped != nil {
		w.Header().Add("Vary", "Accept-Encoding")
		if acceptsGzip(r.Header) {
			// Different bytes from the file, so a different ETag.
			w.Header().Set("ETag", `"`+info.hash+`-gz"`)
			http.ServeContent(
				encodingWriter{ResponseWriter: w, encoding: "gzip"},
				r,
				name,
				info.modTime,
				bytes.NewReader(info.gzipped),
			)

			return
		}
	}

	w.Header().Set("ETag", `"`+info.hash+`"`)
	if info.body != nil {
		http.ServeContent(w, r, name, info.modTime, bytes.NewReader(info.body))

		return
	}
	//nolint:gosec // name passed fs.ValidPath above, and fsys is rooted.
	http.ServeFileFS(w, r, s.fsys, name)
}

// fileInfo hashes the named file and gzips it when its type is compressible;
// the page's links name the build first.
func (s *staticFiles) fileInfo(name string) (*fileInfo, error) {
	if cached, ok := s.info.Load(name); ok {
		if info, isInfo := cached.(*fileInfo); isInfo {
			return info, nil
		}
	}

	f, err := s.fsys.Open(name)
	if err != nil {
		return nil, fmt.Errorf("error opening %q: %w", name, err)
	}
	defer func() { _ = f.Close() }()

	stat, err := f.Stat()
	if err != nil {
		return nil, fmt.Errorf("error reading %q: %w", name, err)
	}
	data, err := io.ReadAll(f)
	if err != nil {
		return nil, fmt.Errorf("error reading %q: %w", name, err)
	}

	info := &fileInfo{modTime: stat.ModTime()}
	if name == indexFile {
		if data, err = s.linkBuild(data); err != nil {
			return nil, fmt.Errorf("error linking %q: %w", name, err)
		}
		info.body = data
	}
	sum := sha256.Sum256(data)
	info.hash = hex.EncodeToString(sum[:etagBytes])
	if compressible(name) {
		gzipped, err := gzipBytes(data)
		if err != nil {
			return nil, fmt.Errorf("error compressing %q: %w", name, err)
		}
		if len(gzipped) < len(data) {
			info.gzipped = gzipped
		}
	}

	if s.fixed {
		s.info.Store(name, info)
	}

	return info, nil
}

// gzipBytes returns data gzipped at the best compression, as it is done once
// per file.
func gzipBytes(data []byte) ([]byte, error) {
	var buf bytes.Buffer
	zw, err := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	if err != nil {
		return nil, fmt.Errorf("error creating gzip writer: %w", err)
	}
	if _, err = zw.Write(data); err != nil {
		return nil, fmt.Errorf("error writing gzip: %w", err)
	}
	if err = zw.Close(); err != nil {
		return nil, fmt.Errorf("error closing gzip: %w", err)
	}

	return buf.Bytes(), nil
}

// acceptsGzip reports whether a request's Accept-Encoding allows gzip: named,
// or as x-gzip, with a q above 0, or else covered by a "*" with one.
func acceptsGzip(header http.Header) bool {
	gzipQ, anyQ := unlisted, unlisted
	for _, value := range header.Values("Accept-Encoding") {
		for coding := range strings.SplitSeq(value, ",") {
			name, params, _ := strings.Cut(coding, ";")
			switch strings.ToLower(strings.TrimSpace(name)) {
			case "gzip", "x-gzip":
				gzipQ = quality(params)
			case "*":
				anyQ = quality(params)
			default:
			}
		}
	}
	if gzipQ != unlisted {
		return gzipQ > 0
	}

	return anyQ > 0
}

// quality is the q parameter of an Accept-Encoding entry: 1 when it has none,
// 0 when it is malformed.
func quality(params string) float64 {
	for param := range strings.SplitSeq(params, ";") {
		key, value, _ := strings.Cut(param, "=")
		if strings.EqualFold(strings.TrimSpace(key), "q") {
			q, err := strconv.ParseFloat(strings.TrimSpace(value), float64Bits)
			if err != nil {
				return 0
			}

			return q
		}
	}

	return 1
}

// encodingWriter sets Content-Encoding on a 200 or 206 only as its status is
// written: [http.ServeContent] leaves out Content-Length when the header is set
// before it runs, and Phaser's loader shows no progress without one (#227).
type encodingWriter struct {
	http.ResponseWriter

	encoding string
}

// WriteHeader adds the encoding to a response that carries the encoded body.
func (w encodingWriter) WriteHeader(code int) {
	if code == http.StatusOK || code == http.StatusPartialContent {
		w.Header().Set("Content-Encoding", w.encoding)
	}
	w.ResponseWriter.WriteHeader(code)
}

// Unwrap returns the wrapped writer, for [http.ResponseController].
func (w encodingWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func handleIndex(files *staticFiles) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		files.serve(w, r, indexFile, "")
	})
}

func handleStatic(files *staticFiles) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		files.serve(w, r, strings.TrimPrefix(r.URL.Path, "/"), "")
	})
}

// handleBuild serves a file under a build's prefix: the pattern's {file...}
// under its {build}.
func handleBuild(files *staticFiles) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		files.serve(w, r, r.PathValue("file"), r.PathValue("build"))
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
