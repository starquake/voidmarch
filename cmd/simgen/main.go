// Command simgen writes frontend/src/sim/rules.gen.ts: the id lists, tunables and
// state layout the browser needs from internal/sim, so the TypeScript never
// keeps its own copy of a rule's numbers.
package main

import (
	"flag"
	"fmt"
	"os"
)

func main() {
	out := flag.String("o", "frontend/src/sim/rules.gen.ts", "the TypeScript file to write")
	flag.Parse()
	const sourceFile = 0o644
	if err := os.WriteFile(*out, []byte(generate()), sourceFile); err != nil {
		fmt.Fprintf(os.Stderr, "error writing %s: %v\n", *out, err)
		os.Exit(1)
	}
}
