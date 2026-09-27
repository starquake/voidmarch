package server_test

import (
	"errors"
	"io/fs"
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
