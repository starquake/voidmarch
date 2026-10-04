package thirdparty_test

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	. "github.com/starquake/voidmarch/internal/thirdparty"
)

func TestReadGoReport(t *testing.T) {
	t.Parallel()

	files := map[string]string{
		"/mod/a/LICENSE": "MIT text  \r\nline two\n\n",
		"/mod/b/LICENSE": "BSD text",
	}
	read := func(name string) ([]byte, error) {
		text, ok := files[name]
		if !ok {
			return nil, os.ErrNotExist
		}

		return []byte(text), nil
	}
	report := "example.com/a\tv1.0.0\tMIT\t/mod/a/LICENSE\n\nexample.com/b\tv2.1.0\tBSD-3-Clause\t/mod/b/LICENSE\n"
	pkgs, err := ReadGoReport(strings.NewReader(report), read)
	if err != nil {
		t.Fatalf("ReadGoReport() error = %v", err)
	}
	if got, want := len(pkgs), 2; got != want {
		t.Fatalf("len(pkgs) = %d, want %d", got, want)
	}
	wantA := Package{
		Name:    "example.com/a",
		Version: "v1.0.0",
		Kind:    "Go module",
		License: "MIT",
		Text:    "MIT text\nline two",
	}
	if got := pkgs[0]; got != wantA {
		t.Errorf("pkgs[0] = %+v, want %+v", got, wantA)
	}

	tests := []struct {
		name   string
		report string
		want   string
	}{
		{"too few fields", "example.com/a\tv1\tMIT\n", "want 4 fields: malformed report line"},
		{
			"missing text",
			"example.com/c\tv1\tMIT\t/mod/c/LICENSE\n",
			"error reading the licence of example.com/c",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			_, err := ReadGoReport(strings.NewReader(tc.report), read)
			if err == nil {
				t.Fatal("ReadGoReport() error = nil, want one")
			}
			if got, want := err.Error(), tc.want; !strings.Contains(got, want) {
				t.Errorf("err.Error() = %q, should contain %q", got, want)
			}
		})
	}
}

func TestReadNPM(t *testing.T) {
	t.Parallel()

	nodeModules := fstest.MapFS{
		"phaser/package.json": {Data: []byte(`{"version":"4.2.1","license":"MIT"}`)},
		"phaser/LICENSE.md":   {Data: []byte("Phaser MIT text\n")},
		"@bufbuild/protobuf/package.json": {
			Data: []byte(`{"version":"2.15.0","license":"(Apache-2.0 AND BSD-3-Clause)"}`),
		},
		"@bufbuild/protobuf/README.md": {Data: []byte("no licence here")},
		"bare/package.json":            {Data: []byte(`{"version":"1.0.0","license":"MIT"}`)},
		"broken/package.json":          {Data: []byte(`{`)},
	}

	pkgs, err := ReadNPM(nodeModules, []string{"phaser", "@bufbuild/protobuf"})
	if err != nil {
		t.Fatalf("ReadNPM() error = %v", err)
	}
	wantPhaser := Package{
		Name:    "phaser",
		Version: "4.2.1",
		Kind:    "npm package",
		License: "MIT",
		Text:    "Phaser MIT text",
	}
	if got := pkgs[0]; got != wantPhaser {
		t.Errorf("pkgs[0] = %+v, want %+v", got, wantPhaser)
	}
	protobuf := pkgs[1]
	if got, want := protobuf.Text, "Apache License"; !strings.Contains(got, want) {
		t.Errorf("@bufbuild/protobuf text should contain %q, the committed copy", want)
	}
	if got, want := protobuf.Text, "Copyright 2008 Google Inc."; !strings.Contains(got, want) {
		t.Errorf(
			"@bufbuild/protobuf text should contain %q, the BSD notice the bundle strips",
			want,
		)
	}

	if _, err := ReadNPM(nodeModules, []string{"bare"}); !errors.Is(err, ErrNoLicence) {
		t.Errorf("ReadNPM(bare) error = %v, want ErrNoLicence", err)
	}
	for _, name := range []string{"broken", "missing"} {
		if _, err := ReadNPM(nodeModules, []string{name}); err == nil {
			t.Errorf("ReadNPM(%s) error = nil, want one", name)
		}
	}
}

func TestRuntimes(t *testing.T) {
	t.Parallel()

	pkgs, err := Runtimes("1.27.1", "0.42.0")
	if err != nil {
		t.Fatalf("Runtimes() error = %v", err)
	}
	for i, want := range []string{"The Go Authors", "The TinyGo Authors"} {
		if got := pkgs[i].Text; !strings.Contains(got, want) {
			t.Errorf("%s's text should contain %q", pkgs[i].Name, want)
		}
	}
	if got, want := pkgs[1].Version, "0.42.0"; got != want {
		t.Errorf("TinyGo version = %q, want %q", got, want)
	}
}

func TestGoVersion(t *testing.T) {
	t.Parallel()

	got, err := GoVersion([]byte("module x\n\ngo 1.27.1\n\nrequire y v1\n"))
	if err != nil {
		t.Fatalf("GoVersion() error = %v", err)
	}
	if want := "1.27.1"; got != want {
		t.Errorf("GoVersion() = %q, want %q", got, want)
	}
	if _, err := GoVersion([]byte("module x\n")); err == nil {
		t.Error("GoVersion() without a go directive error = nil, want one")
	}
}

func TestCheck(t *testing.T) {
	t.Parallel()

	tests := []struct {
		license string
		ok      bool
	}{
		{"MIT", true},
		{"OFL-1.1", true},
		{"(Apache-2.0 AND BSD-3-Clause)", true},
		{"Apache-2.0 AND GPL-3.0-only", false},
		{"(GPL-3.0-only OR MIT)", true},
		{"GPL-3.0-only", false},
		{"Unknown", false},
		{"", false},
	}
	for _, tc := range tests {
		t.Run(tc.license, func(t *testing.T) {
			t.Parallel()

			err := Check([]Package{{Name: "p", Version: "v1", License: tc.license}})
			if got := err == nil; got != tc.ok {
				t.Errorf("Check(%q) error = %v, want allowed %t", tc.license, err, tc.ok)
			}
			if !tc.ok && !errors.Is(err, ErrNotAllowed) {
				t.Errorf("Check(%q) error = %v, want ErrNotAllowed", tc.license, err)
			}
		})
	}
}

func TestRender(t *testing.T) {
	t.Parallel()

	pkgs := []Package{
		{Name: "z.example/b", Version: "v1", Kind: "Go module", License: "MIT", Text: "MIT, Zed"},
		{Name: "a.example/a", Version: "v2", Kind: "Go module", License: "MIT", Text: "MIT, Zed"},
		{
			Name:    "phaser",
			Version: "4.2.1",
			Kind:    "npm package",
			License: "MIT",
			Text:    "MIT, Phaser",
		},
		{Name: "Go", Version: "1.27.1", Kind: "runtime", License: "BSD-3-Clause", Text: "BSD, Go"},
	}
	var out strings.Builder
	if err := Render(&out, pkgs); err != nil {
		t.Fatalf("Render() error = %v", err)
	}
	got := out.String()
	for _, want := range []string{
		"# Third-party licences",
		"- BSD 3-Clause \"New\" or \"Revised\" License: 1\n- MIT License: 3\n",
		"Used by:\n\n- `a.example/a` v2 (Go module)\n- `z.example/b` v1 (Go module)\n\n```text\nMIT, Zed\n```",
		"- `Go` 1.27.1 (runtime)",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("Render() should contain %q, got:\n%s", want, got)
		}
	}
	if got, want := strings.Count(got, "\n## MIT License\n"), 2; got != want {
		t.Errorf("MIT sections = %d, want %d: one per distinct text", got, want)
	}
	if strings.Index(got, "## BSD") > strings.Index(got, "## MIT") {
		t.Error("sections should be sorted by licence")
	}
}

func TestRun(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	write := func(name, text string) string {
		t.Helper()
		p := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o750); err != nil {
			t.Fatalf("os.MkdirAll() error = %v", err)
		}
		if err := os.WriteFile(p, []byte(text), 0o600); err != nil {
			t.Fatalf("os.WriteFile() error = %v", err)
		}

		return p
	}
	licence := write("mod/LICENSE", "ISC text")
	write("node_modules/phaser/package.json", `{"version":"4.2.1","license":"MIT"}`)
	write("node_modules/phaser/LICENSE.md", "Phaser text")
	o := Options{
		GoReport:      write("go.tsv", "example.com/ws\tv1.8.15\tISC\t"+licence+"\n"),
		Packages:      write("packages.json", `["phaser"]`),
		NodeModules:   filepath.Join(dir, "node_modules"),
		GoMod:         write("go.mod", "module x\n\ngo 1.27.1\n"),
		TinyGoVersion: "0.42.0",
		Out:           filepath.Join(dir, "THIRD-PARTY.md"),
	}
	if err := Run(o); err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	out, err := os.ReadFile(o.Out)
	if err != nil {
		t.Fatalf("os.ReadFile() error = %v", err)
	}
	for _, want := range []string{"`example.com/ws` v1.8.15", "`phaser` 4.2.1", "`Go` 1.27.1", "`TinyGo` 0.42.0"} {
		if !strings.Contains(string(out), want) {
			t.Errorf("THIRD-PARTY.md should contain %q", want)
		}
	}

	bad := o
	bad.GoReport = write("bad.tsv", "example.com/gpl\tv1\tGPL-3.0-only\t"+licence+"\n")
	bad.Out = filepath.Join(dir, "bad.md")
	if err := Run(bad); !errors.Is(err, ErrNotAllowed) {
		t.Errorf("Run() with a GPL module error = %v, want ErrNotAllowed", err)
	}
	if _, err := os.Stat(bad.Out); !errors.Is(err, os.ErrNotExist) {
		t.Error("Run() wrote the file despite a licence that isn't allowed")
	}

	for name, broken := range map[string]func(*Options){
		"no report":     func(o *Options) { o.GoReport = filepath.Join(dir, "none") },
		"no list":       func(o *Options) { o.Packages = filepath.Join(dir, "none") },
		"bad list":      func(o *Options) { o.Packages = write("bad.json", "{") },
		"no go.mod":     func(o *Options) { o.GoMod = filepath.Join(dir, "none") },
		"bad go.mod":    func(o *Options) { o.GoMod = write("bad.mod", "module x\n") },
		"unwritable":    func(o *Options) { o.Out = filepath.Join(dir, "missing-dir", "x.md") },
		"no npm module": func(o *Options) { o.Packages = write("missing.json", `["missing"]`) },
	} {
		b := o
		broken(&b)
		if err := Run(b); err == nil {
			t.Errorf("Run() with %s error = nil, want one", name)
		}
	}
}
