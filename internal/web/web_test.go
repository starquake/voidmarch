package web_test

import (
	"errors"
	"fmt"
	"io/fs"
	"strings"
	"testing"

	. "github.com/starquake/voidmarch/internal/web"
)

func TestStatic(t *testing.T) {
	t.Parallel()

	static, err := Static()
	if err != nil {
		t.Fatalf("Static() error = %v", err)
	}

	for _, name := range []string{"index.html", "css/style.css", "js/entry.js", "js/main.js", "js/vendor/phaser.js"} {
		if _, err := fs.Stat(static, name); err != nil {
			t.Errorf("fs.Stat(%q) error = %v", name, err)
		}
	}
}

func TestStatic_Audio(t *testing.T) {
	t.Parallel()

	static, err := Static()
	if err != nil {
		t.Fatalf("Static() error = %v", err)
	}

	for _, tc := range []struct {
		dir      string
		channels byte
	}{
		{dir: "audio/sfx", channels: 1},
		{dir: "audio/music", channels: 2},
	} {
		oggs, err := fs.Glob(static, tc.dir+"/*.ogg")
		if err != nil {
			t.Fatalf("fs.Glob() error = %v", err)
		}
		mp3s, err := fs.Glob(static, tc.dir+"/*.mp3")
		if err != nil {
			t.Fatalf("fs.Glob() error = %v", err)
		}
		if len(oggs) == 0 {
			t.Fatalf("no Ogg files in %s", tc.dir)
		}
		if got, want := len(mp3s), len(oggs); got != want {
			t.Errorf("%s has %d MP3 files, want one per Ogg file (%d)", tc.dir, got, want)
		}

		for _, name := range oggs {
			mp3 := strings.TrimSuffix(name, ".ogg") + ".mp3"
			if _, err := fs.Stat(static, mp3); err != nil {
				t.Errorf("fs.Stat(%q) error = %v, want an MP3 copy of %s", mp3, err, name)
			}

			head, err := oggHead(static, name)
			if err != nil {
				t.Errorf("oggHead(%q) error = %v", name, err)

				continue
			}
			if got, want := string(head[:8]), "OpusHead"; got != want {
				t.Errorf("%s first packet starts %q, want %q (Ogg Opus)", name, got, want)

				continue
			}
			if got, want := head[9], tc.channels; got != want {
				t.Errorf("%s has %d channels, want %d", name, got, want)
			}
		}
	}
}

// oggHead returns the first packet of an Ogg file, which names its codec.
func oggHead(fsys fs.FS, name string) ([]byte, error) {
	data, err := fs.ReadFile(fsys, name)
	if err != nil {
		return nil, fmt.Errorf("error reading %s: %w", name, err)
	}
	const headerLen = 27
	if len(data) < headerLen || string(data[:4]) != "OggS" {
		return nil, fmt.Errorf("error parsing %s: %w", name, errNotOgg)
	}
	segments := int(data[headerLen-1])
	start := headerLen + segments
	if len(data) < start {
		return nil, fmt.Errorf("error parsing %s: %w", name, errNotOgg)
	}
	size := 0
	for _, s := range data[headerLen:start] {
		size += int(s)
	}
	if size < 10 || len(data) < start+size {
		return nil, fmt.Errorf("error parsing %s: %w", name, errNotOgg)
	}

	return data[start : start+size], nil
}

var errNotOgg = errors.New("not an Ogg file")
