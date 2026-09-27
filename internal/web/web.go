// Package web embeds the browser client.
package web

import (
	"embed"
	"fmt"
	"io/fs"
)

//go:embed static
var files embed.FS

// Static returns the embedded client files, rooted at the static directory.
func Static() (fs.FS, error) {
	sub, err := fs.Sub(files, "static")
	if err != nil {
		return nil, fmt.Errorf("error opening embedded static files: %w", err)
	}

	return sub, nil
}
