//go:build tools

// Package tools pins build tools: Dependabot sees new golangci-lint and sqlc
// releases (the Makefile downloads the pinned binaries), and the Makefile
// builds protoc-gen-go and go-licenses from the versions required here.
package tools

import (
	_ "github.com/golangci/golangci-lint/v2/cmd/golangci-lint"
	_ "github.com/google/go-licenses/v2"
	_ "github.com/sqlc-dev/sqlc/cmd/sqlc"
	_ "google.golang.org/protobuf/cmd/protoc-gen-go"
)
