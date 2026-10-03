// Command voidmarch runs the Voidmarch game server.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/starquake/voidmarch/cmd/voidmarch/app"
)

func main() {
	healthcheck := flag.Bool("healthcheck", false,
		"probe http://127.0.0.1:$PORT/healthz and exit 0 or 1; used as the Docker HEALTHCHECK")
	newSeason := flag.Bool("new-season", false,
		"reset the world in DB_PATH for a new season and exit; run it with the server stopped")
	flag.Parse()

	ctx := context.Background()

	var err error
	switch {
	case *healthcheck:
		err = app.Healthcheck(ctx, os.Getenv)
	case *newSeason:
		err = app.NewSeason(ctx, os.Getenv, os.Stdout)
	default:
		err = app.Run(ctx, os.Getenv, os.Stdout, nil)
	}

	if err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}
