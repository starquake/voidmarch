package web_test

import (
	"io/fs"
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
