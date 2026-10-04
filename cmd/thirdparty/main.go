// Command thirdparty writes THIRD-PARTY.md from go-licenses' report, the npm
// packages the client bundle ships and the runtimes (#196); `make
// third-party` runs it.
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/starquake/voidmarch/internal/thirdparty"
)

func main() {
	var o thirdparty.Options
	flag.StringVar(&o.GoReport, "go-report", "", "go-licenses report output for the server")
	flag.StringVar(
		&o.Packages,
		"packages",
		"",
		"the npm packages the bundle ships, from build.mjs --packages",
	)
	flag.StringVar(
		&o.NodeModules,
		"node-modules",
		"frontend/node_modules",
		"the frontend's node_modules",
	)
	flag.StringVar(&o.GoMod, "gomod", "go.mod", "the go.mod naming the Go version")
	flag.StringVar(
		&o.TinyGoVersion,
		"tinygo-version",
		"",
		"the TinyGo release that builds the WebAssembly sim",
	)
	flag.StringVar(&o.Out, "o", "THIRD-PARTY.md", "where to write the file")
	flag.Parse()
	if err := thirdparty.Run(o); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
