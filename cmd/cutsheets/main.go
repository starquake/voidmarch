// Command cutsheets lays out the Void packs' animation strips so no texture
// is over 4096 px (#222). The cut files, and the command that made each, are
// listed in internal/web/static/assets/LICENSE.md.
//
//	go run ./cmd/cutsheets grid -frame 640x360 -columns 3 SRC OUT
//	go run ./cmd/cutsheets grid -frame 96x96 -columns 9 -crop SRC OUT
//	go run ./cmd/cutsheets layer -frame 640x360 SRC OUT.png OUT.json
package main

import (
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/starquake/voidmarch/internal/sheetcut"
)

// gridFiles and layerFiles are how many files each mode names: its source,
// then what it writes.
const (
	gridFiles  = 2
	layerFiles = 3
)

// errUsage is returned for a command line cutsheets can't read.
var errUsage = errors.New(
	"usage: cutsheets grid -frame WxH -columns N [-crop] SRC OUT | " +
		"cutsheets layer -frame WxH SRC OUT.png OUT.json",
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// run cuts one strip as args say.
func run(args []string) error {
	if len(args) == 0 {
		return errUsage
	}
	fs := flag.NewFlagSet(args[0], flag.ContinueOnError)
	frame := fs.String("frame", "", "a frame's width x height, as 640x360")
	columns := fs.Int("columns", 0, "grid: frames per row")
	crop := fs.Bool("crop", false, "grid: trim the margin transparent around every frame")
	if err := fs.Parse(args[1:]); err != nil {
		return fmt.Errorf("error reading the flags: %w", err)
	}
	var w, h int
	if _, err := fmt.Sscanf(*frame, "%dx%d", &w, &h); err != nil {
		return fmt.Errorf("error reading -frame %q: %w", *frame, err)
	}
	files := fs.Args()
	var err error
	switch {
	case args[0] == "grid" && len(files) == gridFiles:
		err = sheetcut.GridFile(sheetcut.GridOptions{
			Src:         files[0],
			Out:         files[1],
			FrameWidth:  w,
			FrameHeight: h,
			Columns:     *columns,
			Crop:        *crop,
		})
	case args[0] == "layer" && len(files) == layerFiles:
		err = sheetcut.SplitFile(files[0], files[1], files[2], w, h)
	default:
		return errUsage
	}
	if err != nil {
		return fmt.Errorf("error cutting %s: %w", files[0], err)
	}

	return nil
}
