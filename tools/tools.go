//go:build tools

// Package tools lets Dependabot see new golangci-lint releases. Nothing
// installs from here: the Makefile pins and downloads the release binary.
package tools

import (
	_ "github.com/golangci/golangci-lint/v2/cmd/golangci-lint"
)
