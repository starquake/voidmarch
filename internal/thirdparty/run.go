package thirdparty

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
)

// fileMode is THIRD-PARTY.md's: a committed text file anyone may read.
const fileMode = 0o644

// Options are the files Run reads and writes.
type Options struct {
	// GoReport is go-licenses report output for the server (ReadGoReport).
	GoReport string
	// Packages is the JSON list of npm packages the bundle ships, from
	// frontend/build.mjs --packages.
	Packages string
	// NodeModules is the frontend's node_modules directory.
	NodeModules string
	// GoMod is the go.mod whose go directive names the Go runtime's version.
	GoMod string
	// TinyGoVersion is the TinyGo release that builds the WebAssembly sim.
	TinyGoVersion string
	// Out is where THIRD-PARTY.md goes.
	Out string
}

// Run gathers every shipped package, checks their licences and writes the file.
func Run(o Options) error {
	report, err := os.ReadFile(o.GoReport)
	if err != nil {
		return fmt.Errorf("error reading the Go report: %w", err)
	}
	goPkgs, err := ReadGoReport(bytes.NewReader(report), os.ReadFile)
	if err != nil {
		return err
	}
	list, err := os.ReadFile(o.Packages)
	if err != nil {
		return fmt.Errorf("error reading the npm package list: %w", err)
	}
	var names []string
	if err = json.Unmarshal(list, &names); err != nil {
		return fmt.Errorf("error parsing the npm package list: %w", err)
	}
	npmPkgs, err := ReadNPM(os.DirFS(o.NodeModules), names)
	if err != nil {
		return err
	}
	gomod, err := os.ReadFile(o.GoMod)
	if err != nil {
		return fmt.Errorf("error reading go.mod: %w", err)
	}
	goVersion, err := GoVersion(gomod)
	if err != nil {
		return err
	}
	runtimes, err := Runtimes(goVersion, o.TinyGoVersion)
	if err != nil {
		return err
	}
	pkgs := append(append(goPkgs, npmPkgs...), runtimes...)
	if err = Check(pkgs); err != nil {
		return fmt.Errorf("error checking licences: %w", err)
	}
	var out bytes.Buffer
	if err = Render(&out, pkgs); err != nil {
		return err
	}
	//nolint:gosec // THIRD-PARTY.md is committed, and anyone may read it.
	if err = os.WriteFile(o.Out, out.Bytes(), fileMode); err != nil {
		return fmt.Errorf("error writing %s: %w", o.Out, err)
	}

	return nil
}
