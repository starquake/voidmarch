// Package thirdparty writes THIRD-PARTY.md: the libraries the server binary
// and the browser client are built from, with their licences, and fails on a
// licence that isn't on the allow list (#196).
package thirdparty

import (
	"bufio"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"path"
	"regexp"
	"slices"
	"strings"
)

//go:embed texts
var texts embed.FS

// ErrNotAllowed is returned when a package's licence isn't on the allow list.
var ErrNotAllowed = errors.New("licence not allowed")

// ErrNoLicence is returned when a package has no licence text to attribute.
var ErrNoLicence = errors.New("no licence text")

// ErrBadReport is returned for a go-licenses report line it can't read.
var ErrBadReport = errors.New("malformed report line")

// ErrNoGoDirective is returned for a go.mod without a go directive.
var ErrNoGoDirective = errors.New("no go directive")

const newline = "\n"

// allowedName is the name of an allowed SPDX identifier, and false for any
// other (#196 decision 4).
func allowedName(id string) (string, bool) {
	switch id {
	case "Apache-2.0":
		return "Apache License 2.0", true
	case "BSD-2-Clause":
		return `BSD 2-Clause "Simplified" License`, true
	case "BSD-3-Clause":
		return `BSD 3-Clause "New" or "Revised" License`, true
	case "CC0-1.0":
		return "Creative Commons Zero v1.0 Universal", true
	case "ISC":
		return "ISC License", true
	case "MIT":
		return "MIT License", true
	case "OFL-1.1":
		return "SIL Open Font License 1.1", true
	default:
		return "", false
	}
}

// fallbackText is the committed licence text of an npm package whose tarball
// leaves the file out.
func fallbackText(name string) (string, bool) {
	if name == "@bufbuild/protobuf" {
		return "texts/protobuf-es.txt", true
	}

	return "", false
}

// Package is one library in the shipped program, with its licence.
type Package struct {
	Name    string
	Version string
	// Kind says where it ships: "Go module", "npm package" or "runtime".
	Kind string
	// License is an SPDX identifier or expression.
	License string
	Text    string
}

// ReadGoReport reads go-licenses report output, one package a line as
// "name<TAB>version<TAB>licence<TAB>path", taking each text from readFile.
func ReadGoReport(r io.Reader, readFile func(string) ([]byte, error)) ([]Package, error) {
	var pkgs []Package
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		const fields = 4
		parts := strings.Split(line, "\t")
		if len(parts) != fields {
			return nil, fmt.Errorf(
				"error reading %q, want %d fields: %w",
				line,
				fields,
				ErrBadReport,
			)
		}
		text, err := readFile(parts[3])
		if err != nil {
			return nil, fmt.Errorf("error reading the licence of %s: %w", parts[0], err)
		}
		pkgs = append(pkgs, Package{
			Name:    parts[0],
			Version: parts[1],
			Kind:    "Go module",
			License: parts[2],
			Text:    normalize(string(text)),
		})
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error reading the report: %w", err)
	}

	return pkgs, nil
}

var licenceFile = regexp.MustCompile(`(?i)^licen[cs]e(\.(md|txt))?$`)

// ReadNPM reads the named packages from nodeModules (a node_modules
// directory): the version and licence from package.json, and the text from
// the package's licence file, or a committed copy where it ships none.
func ReadNPM(nodeModules fs.FS, names []string) ([]Package, error) {
	pkgs := make([]Package, 0, len(names))
	for _, name := range names {
		manifest, err := fs.ReadFile(nodeModules, path.Join(name, "package.json"))
		if err != nil {
			return nil, fmt.Errorf("error reading %s's package.json: %w", name, err)
		}
		var meta struct {
			Version string `json:"version"`
			License string `json:"license"`
		}
		if err = json.Unmarshal(manifest, &meta); err != nil {
			return nil, fmt.Errorf("error parsing %s's package.json: %w", name, err)
		}
		text, err := npmLicence(nodeModules, name)
		if err != nil {
			return nil, err
		}
		pkgs = append(pkgs, Package{
			Name:    name,
			Version: meta.Version,
			Kind:    "npm package",
			License: meta.License,
			Text:    text,
		})
	}

	return pkgs, nil
}

func npmLicence(nodeModules fs.FS, name string) (string, error) {
	entries, err := fs.ReadDir(nodeModules, name)
	if err != nil {
		return "", fmt.Errorf("error listing %s: %w", name, err)
	}
	for _, entry := range entries {
		if !entry.IsDir() && licenceFile.MatchString(entry.Name()) {
			text, readErr := fs.ReadFile(nodeModules, path.Join(name, entry.Name()))
			if readErr != nil {
				return "", fmt.Errorf("error reading %s's licence: %w", name, readErr)
			}

			return normalize(string(text)), nil
		}
	}
	if file, ok := fallbackText(name); ok {
		return embedded(file)
	}

	return "", fmt.Errorf("error attributing %s: %w", name, ErrNoLicence)
}

// Runtimes are the Go runtime in the server and TinyGo's in the WebAssembly
// sim, at the given versions.
func Runtimes(goVersion, tinygoVersion string) ([]Package, error) {
	goText, err := embedded("texts/go.txt")
	if err != nil {
		return nil, err
	}
	tinygoText, err := embedded("texts/tinygo.txt")
	if err != nil {
		return nil, err
	}

	return []Package{
		{Name: "Go", Version: goVersion, Kind: "runtime", License: "BSD-3-Clause", Text: goText},
		{
			Name:    "TinyGo",
			Version: tinygoVersion,
			Kind:    "runtime",
			License: "BSD-3-Clause",
			Text:    tinygoText,
		},
	}, nil
}

func embedded(file string) (string, error) {
	text, err := texts.ReadFile(file)
	if err != nil {
		return "", fmt.Errorf("error reading %s: %w", file, err)
	}

	return normalize(string(text)), nil
}

var goDirective = regexp.MustCompile(`(?m)^go (\S+)$`)

// GoVersion is the Go version a go.mod asks for.
func GoVersion(gomod []byte) (string, error) {
	match := goDirective.FindSubmatch(gomod)
	if match == nil {
		return "", fmt.Errorf("error reading go.mod: %w", ErrNoGoDirective)
	}

	return string(match[1]), nil
}

// Check returns an error naming every package whose licence isn't allowed.
func Check(pkgs []Package) error {
	var errs []error
	for _, p := range pkgs {
		if !licenceAllowed(p.License) {
			errs = append(
				errs,
				fmt.Errorf("%s %s (%s): %w", p.Name, p.Version, p.License, ErrNotAllowed),
			)
		}
	}

	return errors.Join(errs...)
}

// licenceAllowed reports whether an SPDX expression of AND and OR, without
// nesting, is allowed: every AND term, or one OR term.
func licenceAllowed(expr string) bool {
	ids, joiner := spdxTerms(expr)
	if len(ids) == 0 {
		return false
	}
	ok := func(id string) bool {
		_, found := allowedName(id)

		return found
	}
	if joiner == " OR " {
		return slices.ContainsFunc(ids, ok)
	}

	return !slices.ContainsFunc(ids, func(id string) bool { return !ok(id) })
}

func spdxTerms(expr string) ([]string, string) {
	expr = strings.Trim(strings.TrimSpace(expr), "()")
	joiner := " AND "
	if strings.Contains(expr, " OR ") {
		joiner = " OR "
	}
	var ids []string
	for id := range strings.SplitSeq(expr, joiner) {
		if id = strings.TrimSpace(id); id != "" {
			ids = append(ids, id)
		}
	}

	return ids, joiner
}

// licenceName is an expression with each identifier spelled out.
func licenceName(expr string) string {
	ids, joiner := spdxTerms(expr)
	names := make([]string, len(ids))
	for i, id := range ids {
		name, found := allowedName(id)
		if !found {
			name = id
		}
		names[i] = name
	}

	return strings.Join(names, strings.ToLower(joiner))
}

func normalize(text string) string {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", newline), newline)
	for i, line := range lines {
		lines[i] = strings.TrimRight(line, " \t")
	}

	return strings.Trim(strings.Join(lines, newline), newline)
}

type section struct {
	title string
	text  string
	pkgs  []Package
}

// Render writes THIRD-PARTY.md: a count per licence, then one section per
// distinct licence text with the packages that use it.
func Render(w io.Writer, pkgs []Package) error {
	sections := map[[2]string]*section{}
	for _, p := range pkgs {
		key := [2]string{licenceName(p.License), p.Text}
		if sections[key] == nil {
			sections[key] = &section{title: key[0], text: key[1]}
		}
		sections[key].pkgs = append(sections[key].pkgs, p)
	}
	sorted := make([]*section, 0, len(sections))
	counts := map[string]int{}
	for _, s := range sections {
		slices.SortFunc(s.pkgs, func(a, b Package) int { return strings.Compare(a.Name, b.Name) })
		sorted = append(sorted, s)
		counts[s.title] += len(s.pkgs)
	}
	slices.SortFunc(sorted, func(a, b *section) int {
		if c := strings.Compare(a.title, b.title); c != 0 {
			return c
		}

		return strings.Compare(a.pkgs[0].Name, b.pkgs[0].Name)
	})

	var b strings.Builder
	b.WriteString(header)
	titles := make([]string, 0, len(counts))
	for title := range counts {
		titles = append(titles, title)
	}
	slices.Sort(titles)
	for _, title := range titles {
		fmt.Fprintf(&b, "- %s: %d\n", title, counts[title])
	}
	for _, s := range sorted {
		fmt.Fprintf(&b, "\n## %s\n\nUsed by:\n\n", s.title)
		for _, p := range s.pkgs {
			fmt.Fprintf(&b, "- `%s` %s (%s)\n", p.Name, p.Version, p.Kind)
		}
		fmt.Fprintf(&b, "\n```text\n%s\n```\n", s.text)
	}
	if _, err := io.WriteString(w, b.String()); err != nil {
		return fmt.Errorf("error writing THIRD-PARTY.md: %w", err)
	}

	return nil
}

const header = `# Third-party licences

The Voidmarch server and its browser client are built from the libraries
below, and their licences ask that their notices travel with them. This file
carries them: the Go modules and the Go runtime in the server, the npm packages
bundled into the client, and the TinyGo runtime in its WebAssembly sim.

` + "`make third-party`" + ` writes it, and CI fails when it is stale, so don't edit it by
hand. The game's art, sounds and fonts carry their own licences, in
` + "`internal/web/static/assets/LICENSE.md`" + `, ` + "`internal/web/static/audio/LICENSE.md`" + `
and ` + "`internal/web/static/fonts/`" + `.

Packages per licence:

`
