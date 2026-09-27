SHELL := /bin/bash -o pipefail
.DEFAULT_GOAL := help

BUILD_DIR := build
BIN_DIR := $(BUILD_DIR)/bin
COV_DIR := $(BUILD_DIR)/coverage
FRONTEND := frontend
JS_OUT := internal/web/static/js
JS_DEPS := $(FRONTEND)/node_modules/.package-lock.json

GOLANGCI_VERSION := v2.13.2
GOLANGCI_BIN := $(BIN_DIR)/golangci-lint

UNAME_S := $(shell uname -s | tr '[:upper:]' '[:lower:]')
UNAME_M := $(shell uname -m)
ARCH := $(if $(filter x86_64,$(UNAME_M)),amd64,$(if $(filter aarch64,$(UNAME_M)),arm64,$(UNAME_M)))

# A downloaded tool records its version beside the binary; a mismatch with the
# pin deletes the binary so the next run fetches the pinned one. Skipped for
# `make -n`.
MAKE_DRY_RUN := $(if $(filter-out -%,$(firstword $(MAKEFLAGS))),$(findstring n,$(firstword $(MAKEFLAGS))))
toolpin = $(if $(MAKE_DRY_RUN),,$(shell [ "$$(cat $(1).version 2>/dev/null)" = "$(2)" ] || rm -f $(1)))
TOOLPIN_CHECKED := $(call toolpin,$(GOLANGCI_BIN),$(GOLANGCI_VERSION))

VERSION_PKG := github.com/starquake/voidmarch/internal/version
VERSION_LDFLAGS := -X $(VERSION_PKG).Version=$(shell cat VERSION 2>/dev/null) \
	-X $(VERSION_PKG).Commit=$(shell git rev-parse HEAD 2>/dev/null)$(shell git diff --quiet HEAD 2>/dev/null || echo -dirty) \
	-X $(VERSION_PKG).Date=$(shell date -u +%Y-%m-%dT%H:%M:%SZ)

COVERPKG := $(shell go list ./... | grep -v -E '/cmd/voidmarch$$|/internal/testutil$$|/test/' | paste -sd "," -)

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: check
check: lint lint-ascii ts-check ts-lint ts-test js-check build test-coverage ## Everything CI runs except E2E; run before every PR

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
	@hits=$$(find cmd internal test -name '*.go' -print0 | xargs -0 perl -ne 'print "$$ARGV:$$.: $$_" if /[^\x00-\x7F]/'); \
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
