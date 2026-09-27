//go:build tools

// Package tools pins build tools: Dependabot sees new golangci-lint releases
// (the Makefile downloads the pinned binary), and the Makefile builds
// protoc-gen-go from the version required here.
package tools

import (
	_ "github.com/golangci/golangci-lint/v2/cmd/golangci-lint"
	_ "google.golang.org/protobuf/cmd/protoc-gen-go"
)
