SHELL := /bin/bash -o pipefail
.DEFAULT_GOAL := help

BUILD_DIR := build
BIN_DIR := $(BUILD_DIR)/bin
COV_DIR := $(BUILD_DIR)/coverage
FRONTEND := frontend
JS_OUT := internal/web/static/js
JS_DEPS := $(FRONTEND)/node_modules/.package-lock.json

GOLANGCI_VERSION := v2.14.0
GOLANGCI_BIN := $(BIN_DIR)/golangci-lint
BUF_VERSION := v1.73.0
BUF_BIN := $(BIN_DIR)/buf
# Generates internal/db from internal/store/queries (#77). Dependabot watches
# tools/go.mod; mirror a bump there into this pin.
SQLC_VERSION := v1.31.1
SQLC_BIN := $(BIN_DIR)/sqlc
# Compiles internal/sim to WebAssembly for the browser (#53). Toolchains
# unpack under a _ directory, which ./... skips: TinyGo ships Go sources.
TOOLCHAINS := $(BUILD_DIR)/_toolchains
TINYGO_VERSION := 0.42.0
TINYGO_BIN := $(TOOLCHAINS)/tinygo/bin/tinygo
# TinyGo runs Binaryen's wasm-opt on every WebAssembly build.
BINARYEN_VERSION := version_133
WASM_OPT := $(TOOLCHAINS)/binaryen/bin/wasm-opt
TINYGO := WASMOPT=$(abspath $(WASM_OPT)) $(TINYGO_BIN)
# Built from the versions tools/go.mod requires.
PROTOC_GEN_GO := $(BIN_DIR)/protoc-gen-go
GO_LICENSES := $(BIN_DIR)/go-licenses

UNAME_S := $(shell uname -s | tr '[:upper:]' '[:lower:]')
UNAME_M := $(shell uname -m)
ARCH := $(if $(filter x86_64,$(UNAME_M)),amd64,$(if $(filter aarch64,$(UNAME_M)),arm64,$(UNAME_M)))
BUF_ASSET := buf-$(shell uname -s)-$(UNAME_M)
SQLC_TARBALL := sqlc_$(patsubst v%,%,$(SQLC_VERSION))_$(UNAME_S)_$(ARCH).tar.gz
BINARYEN_ASSET := binaryen-$(BINARYEN_VERSION)-$(UNAME_M)-$(if $(filter darwin,$(UNAME_S)),macos,linux).tar.gz

# A downloaded tool records its version beside the binary; a mismatch with the
# pin deletes the binary so the next run fetches the pinned one. Skipped for
# `make -n`.
MAKE_DRY_RUN := $(if $(filter-out -%,$(firstword $(MAKEFLAGS))),$(findstring n,$(firstword $(MAKEFLAGS))))
toolpin = $(if $(MAKE_DRY_RUN),,$(shell [ "$$(cat $(1).version 2>/dev/null)" = "$(2)" ] || rm -f $(1)))
TOOLPIN_CHECKED := $(call toolpin,$(GOLANGCI_BIN),$(GOLANGCI_VERSION))$(call toolpin,$(BUF_BIN),$(BUF_VERSION))$(call toolpin,$(SQLC_BIN),$(SQLC_VERSION))$(call toolpin,$(TINYGO_BIN),$(TINYGO_VERSION))$(call toolpin,$(WASM_OPT),$(BINARYEN_VERSION))

VERSION_PKG := github.com/starquake/voidmarch/internal/version
VERSION_LDFLAGS := -X $(VERSION_PKG).Version=$(shell cat VERSION 2>/dev/null) \
	-X $(VERSION_PKG).Commit=$(shell git rev-parse HEAD 2>/dev/null)$(shell git diff --quiet HEAD 2>/dev/null || echo -dirty) \
	-X $(VERSION_PKG).Date=$(shell date -u +%Y-%m-%dT%H:%M:%SZ)

COVERPKG := $(shell go list ./... | grep -v -E '/cmd/voidmarch$$|/cmd/thirdparty$$|/cmd/cutsheets$$|/internal/testutil$$|/internal/gen/|/internal/db$$|/test/' | paste -sd "," -)

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: check
check: lint lint-ascii proto-lint proto-check sqlc-check third-party-check ts-check ts-lint ts-test js-check wasm-check build test-coverage test-tinygo test-wasm-fallback ## Everything CI runs except E2E; run before every PR

# --- Go -----------------------------------------------------------------------

$(GOLANGCI_BIN):
	@mkdir -p $(BIN_DIR)
	curl -sSfL --retry 5 --retry-delay 2 --retry-all-errors \
		https://github.com/golangci/golangci-lint/releases/download/$(GOLANGCI_VERSION)/golangci-lint-$(GOLANGCI_VERSION:v%=%)-$(UNAME_S)-$(ARCH).tar.gz \
		| tar -xz --strip-components=1 -C $(BIN_DIR) golangci-lint-$(GOLANGCI_VERSION:v%=%)-$(UNAME_S)-$(ARCH)/golangci-lint
	@echo $(GOLANGCI_VERSION) > $@.version

.PHONY: golangci-version
golangci-version: ## Print the pinned golangci-lint version (read by CI)
	@echo $(GOLANGCI_VERSION)

.PHONY: lint
lint: $(GOLANGCI_BIN) ## Lint Go code
	$(GOLANGCI_BIN) run

.PHONY: lint-fix
lint-fix: $(GOLANGCI_BIN) $(JS_DEPS) ## Lint and auto-fix Go and TypeScript code
	$(GOLANGCI_BIN) run --fix
	cd $(FRONTEND) && npm run lint:fix

.PHONY: lint-ascii
lint-ascii: ## Fail on non-ASCII characters in Go sources
	@hits=$$(find cmd internal test -name '*.go' -print0 | xargs -0 perl -ne 'print "$$ARGV:$$.: $$_" if /[^\x00-\x7F]/; close ARGV if eof'); \
	if [ -n "$$hits" ]; then echo "$$hits"; echo "non-ASCII characters in Go sources"; exit 1; fi

.PHONY: build
build: ## Build the server binary into build/bin
	@mkdir -p $(BIN_DIR)
	go build -ldflags "$(VERSION_LDFLAGS)" -o $(BIN_DIR)/voidmarch ./cmd/voidmarch

.PHONY: test
test: ## Fast Go tests (integration tests skip under -short)
	go test -short -race ./...

.PHONY: test-all
test-all: ## All Go tests, including integration
	go test -race ./...

.PHONY: test-coverage
test-coverage: ## All Go tests with a coverage profile in build/coverage
	@mkdir -p $(COV_DIR)
	go test -race -coverpkg=$(COVERPKG) -coverprofile=$(COV_DIR)/coverage.out ./...
	go tool cover -func=$(COV_DIR)/coverage.out | tail -1

.PHONY: test-coverage-html
test-coverage-html: test-coverage ## Open the Go coverage report in a browser
	go tool cover -html=$(COV_DIR)/coverage.out

.PHONY: server
server: ## Run the server with the embedded client on :8080
	APP_ENV=development go run -ldflags "$(VERSION_LDFLAGS)" ./cmd/voidmarch

.PHONY: server-dev
server-dev: ## Run the server serving the client from disk (pair with js-watch)
	APP_ENV=development WEB_DIR=internal/web/static go run -ldflags "$(VERSION_LDFLAGS)" ./cmd/voidmarch

# --- Database -----------------------------------------------------------------

$(SQLC_BIN):
	@mkdir -p $(BIN_DIR)
	@tmp=$$(mktemp -d) && \
		curl -sSfL --retry 5 --retry-delay 2 --retry-all-errors -o $$tmp/sqlc.tar.gz \
			https://github.com/sqlc-dev/sqlc/releases/download/$(SQLC_VERSION)/$(SQLC_TARBALL) && \
		tar -xzf $$tmp/sqlc.tar.gz -C $$tmp && mv $$tmp/sqlc $@ && rm -rf $$tmp
	@chmod +x $@
	@echo $(SQLC_VERSION) > $@.version

.PHONY: sqlc
sqlc: $(SQLC_BIN) ## Generate internal/db from internal/store/queries
	$(SQLC_BIN) generate

.PHONY: sqlc-check
sqlc-check: $(SQLC_BIN) ## Vet the queries and fail when internal/db is stale
	$(SQLC_BIN) vet
	@$(SQLC_BIN) diff || { echo "internal/db is stale: run make sqlc"; exit 1; }

# --- Protocol -----------------------------------------------------------------

$(BUF_BIN):
	@mkdir -p $(BIN_DIR)
	curl -sSfL --retry 5 --retry-delay 2 --retry-all-errors -o $@ \
		https://github.com/bufbuild/buf/releases/download/$(BUF_VERSION)/$(BUF_ASSET)
	@chmod +x $@
	@echo $(BUF_VERSION) > $@.version

$(PROTOC_GEN_GO): tools/go.mod
	@mkdir -p $(BIN_DIR)
	cd tools && go build -o ../$(PROTOC_GEN_GO) google.golang.org/protobuf/cmd/protoc-gen-go

$(GO_LICENSES): tools/go.mod
	@mkdir -p $(BIN_DIR)
	cd tools && go build -o ../$(GO_LICENSES) github.com/google/go-licenses/v2

PROTO_TOOLS := $(BUF_BIN) $(PROTOC_GEN_GO) $(JS_DEPS)

.PHONY: proto
proto: $(PROTO_TOOLS) ## Generate Go and TypeScript from proto/
	$(BUF_BIN) generate

.PHONY: proto-lint
proto-lint: $(BUF_BIN) ## Lint the protobuf schema
	$(BUF_BIN) lint

.PHONY: proto-check
proto-check: $(PROTO_TOOLS) ## Fail when the committed generated code is stale
	@tmp=$$(mktemp -d); \
	$(BUF_BIN) generate -o "$$tmp" && \
	diff -r "$$tmp/internal/gen" internal/gen && diff -r "$$tmp/frontend/src/gen" frontend/src/gen \
		|| { echo "generated code is stale: run make proto"; rm -rf "$$tmp"; exit 1; }; \
	rm -rf "$$tmp"

# --- Game rules ---------------------------------------------------------------

$(TINYGO_BIN):
	@rm -rf $(TOOLCHAINS)/tinygo && mkdir -p $(TOOLCHAINS)
	curl -sSfL --retry 5 --retry-delay 2 --retry-all-errors \
		https://github.com/tinygo-org/tinygo/releases/download/v$(TINYGO_VERSION)/tinygo$(TINYGO_VERSION).$(UNAME_S)-$(ARCH).tar.gz \
		| tar -xz -C $(TOOLCHAINS)
	@echo $(TINYGO_VERSION) > $@.version

$(WASM_OPT):
	@rm -rf $(TOOLCHAINS)/binaryen $(TOOLCHAINS)/binaryen-$(BINARYEN_VERSION) && mkdir -p $(TOOLCHAINS)
	curl -sSfL --retry 5 --retry-delay 2 --retry-all-errors \
		https://github.com/WebAssembly/binaryen/releases/download/$(BINARYEN_VERSION)/$(BINARYEN_ASSET) \
		| tar -xz -C $(TOOLCHAINS)
	mv $(TOOLCHAINS)/binaryen-$(BINARYEN_VERSION) $(TOOLCHAINS)/binaryen
	@echo $(BINARYEN_VERSION) > $@.version

.PHONY: toolchain-versions
toolchain-versions: ## Print the pinned TinyGo and Binaryen versions (CI's cache key)
	@echo tinygo-$(TINYGO_VERSION)-binaryen-$(BINARYEN_VERSION)

WASM_OUT := internal/web/static/wasm
# A reactor (c-shared) with no scheduler: each export is a plain call. In
# command mode every call went through TinyGo's scheduler, about 40 µs each.
SIM_WASM_FLAGS := -target=wasm -no-debug -buildmode=c-shared -scheduler=none

.PHONY: wasm
wasm: $(TINYGO_BIN) $(WASM_OPT) simgen ## Build the browser's sim into internal/web/static/wasm with TinyGo
	@mkdir -p $(WASM_OUT)
	$(TINYGO) build $(SIM_WASM_FLAGS) -o $(WASM_OUT)/sim.wasm ./cmd/simwasm
	cp $(TOOLCHAINS)/tinygo/targets/wasm_exec.js $(WASM_OUT)/wasm_exec.js

.PHONY: wasm-check
wasm-check: $(TINYGO_BIN) $(WASM_OPT) ## Fail when the committed sim module or its generated TypeScript is stale
	@tmp=$$(mktemp -d); \
	go run ./cmd/simgen -o "$$tmp/sim.ts" && \
	$(TINYGO) build $(SIM_WASM_FLAGS) -o "$$tmp/sim.wasm" ./cmd/simwasm && \
	cmp -s "$$tmp/sim.ts" $(FRONTEND)/src/sim/rules.gen.ts && \
	cmp -s "$$tmp/sim.wasm" $(WASM_OUT)/sim.wasm && \
	cmp -s $(TOOLCHAINS)/tinygo/targets/wasm_exec.js $(WASM_OUT)/wasm_exec.js \
		|| { echo "the sim module is stale: run make wasm"; rm -rf "$$tmp"; exit 1; }; \
	rm -rf "$$tmp"

.PHONY: test-wasm-fallback
test-wasm-fallback: $(JS_DEPS) ## Run the sim module's tests on a standard Go build, the way out if TinyGo goes
	@tmp=$$(mktemp -d); \
	GOOS=js GOARCH=wasm go build -o "$$tmp/sim.wasm" ./cmd/simwasm && \
	(cd $(FRONTEND) && SIM_WASM="$$tmp/sim.wasm" SIM_WASM_EXEC="$$(go env GOROOT)/lib/wasm/wasm_exec.js" \
		node --test src/simwasm.test.ts > "$$tmp/test.log" 2>&1) \
		|| { cat "$$tmp/test.log"; rm -rf "$$tmp"; exit 1; }; \
	grep -E "^ℹ (pass|fail)" "$$tmp/test.log"; rm -rf "$$tmp"

.PHONY: simgen
simgen: ## Write the id lists, tunables and state layout the client needs from internal/sim
	go run ./cmd/simgen -o $(FRONTEND)/src/sim/rules.gen.ts

.PHONY: test-tinygo
test-tinygo: $(TINYGO_BIN) $(WASM_OPT) ## Run internal/sim's tests compiled by TinyGo, as the browser will run the rules
	@tmp=$$(mktemp -d); \
	$(TINYGO) test -c -target=wasip1 -o "$$tmp/sim.wasm" ./internal/sim && \
	node --disable-warning=ExperimentalWarning $(FRONTEND)/scripts/wasi-test.ts "$$tmp/sim.wasm" internal/sim; \
	status=$$?; rm -rf "$$tmp"; exit $$status

# --- Frontend -----------------------------------------------------------------

$(JS_DEPS): $(FRONTEND)/package.json $(FRONTEND)/package-lock.json
	cd $(FRONTEND) && npm ci
	@touch $@

.PHONY: js
js: $(JS_DEPS) ## Bundle the client into internal/web/static/js
	cd $(FRONTEND) && npm run build

.PHONY: js-watch
js-watch: $(JS_DEPS) ## Rebundle the client on every change
	cd $(FRONTEND) && npm run watch

# THIRD-PARTY.md (#196): what ships, as the image builds it for Linux, and
# only the licences on this list.
THIRD_PARTY_DIR := $(BUILD_DIR)/third-party
ALLOWED_LICENSES := Apache-2.0,BSD-2-Clause,BSD-3-Clause,CC0-1.0,ISC,MIT,OFL-1.1
GO_LICENSES_RUN := GOOS=linux GOARCH=amd64 $(GO_LICENSES)
THIRD_PARTY_GEN := go run ./cmd/thirdparty -go-report $(THIRD_PARTY_DIR)/go.tsv \
	-packages $(THIRD_PARTY_DIR)/packages.json -node-modules $(FRONTEND)/node_modules \
	-tinygo-version $(TINYGO_VERSION)

.PHONY: third-party-inputs
third-party-inputs: $(GO_LICENSES) $(JS_DEPS)
	@mkdir -p $(THIRD_PARTY_DIR)
	@$(GO_LICENSES_RUN) check ./cmd/voidmarch --ignore github.com/starquake/voidmarch \
		--allowed_licenses=$(ALLOWED_LICENSES) 2>$(THIRD_PARTY_DIR)/go-licenses.log || \
		{ cat $(THIRD_PARTY_DIR)/go-licenses.log; exit 1; }
	@$(GO_LICENSES_RUN) report ./cmd/voidmarch --ignore github.com/starquake/voidmarch \
		--template internal/thirdparty/report.tpl >$(THIRD_PARTY_DIR)/go.tsv 2>$(THIRD_PARTY_DIR)/go-licenses.log || \
		{ cat $(THIRD_PARTY_DIR)/go-licenses.log; exit 1; }
	@tmp=$$(mktemp -d); \
	(cd $(FRONTEND) && node build.mjs --outdir "$$tmp" --packages ../$(THIRD_PARTY_DIR)/packages.json) >/dev/null; \
	rc=$$?; rm -rf "$$tmp"; exit $$rc

.PHONY: third-party
third-party: third-party-inputs ## Write THIRD-PARTY.md: the libraries that ship and their licences
	$(THIRD_PARTY_GEN) -o THIRD-PARTY.md

.PHONY: third-party-check
third-party-check: third-party-inputs ## Fail when THIRD-PARTY.md is stale, or a licence isn't allowed
	@$(THIRD_PARTY_GEN) -o $(THIRD_PARTY_DIR)/THIRD-PARTY.md && \
	diff -u THIRD-PARTY.md $(THIRD_PARTY_DIR)/THIRD-PARTY.md || \
	{ echo "THIRD-PARTY.md is stale: run make third-party"; exit 1; }

.PHONY: js-check
js-check: $(JS_DEPS) ## Fail when the committed bundle differs from a fresh build
	@tmp=$$(mktemp -d); \
	(cd $(FRONTEND) && node build.mjs --outdir "$$tmp") >/dev/null && \
	diff -r "$$tmp" $(JS_OUT) || { echo "the committed bundle is stale: run make js"; rm -rf "$$tmp"; exit 1; }; \
	rm -rf "$$tmp"

.PHONY: ts-check
ts-check: $(JS_DEPS) ## Type-check the TypeScript
	cd $(FRONTEND) && npm run check

.PHONY: ts-lint
ts-lint: $(JS_DEPS) ## Lint the TypeScript
	cd $(FRONTEND) && npm run lint

.PHONY: ts-test
ts-test: $(JS_DEPS) ## TypeScript unit tests with a coverage gate on src/sim
	cd $(FRONTEND) && npm test

.PHONY: e2e-install
e2e-install: $(JS_DEPS) ## Install the Playwright browsers
	cd $(FRONTEND) && npx playwright install chromium firefox

.PHONY: test-e2e
test-e2e: $(JS_DEPS) js ## Browser tests against the embedded client (chromium, firefox)
	cd $(FRONTEND) && npx playwright test

# --- Docker -------------------------------------------------------------------

.PHONY: docker
docker: ## Build the Docker image as voidmarch:dev
	docker build \
		--build-arg COMMIT=$$(git rev-parse HEAD 2>/dev/null) \
		--build-arg DATE=$$(date -u +%Y-%m-%dT%H:%M:%SZ) \
		-t voidmarch:dev .

.PHONY: clean
clean: ## Remove build output
	rm -rf $(BUILD_DIR) $(FRONTEND)/test-results $(FRONTEND)/playwright-report
