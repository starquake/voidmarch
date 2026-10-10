#!/usr/bin/env bash
# deploy-remote_test.sh: runs deploy-remote.sh against a stub docker in a
# temporary home and checks what it writes and runs.
set -uo pipefail

script="$(cd "$(dirname "$0")" && pwd)/deploy-remote.sh"
digest="sha256:$(printf '%064d' 0)"
failed=0

fail() {
  echo "FAIL: $*" >&2
  failed=1
}

# setup makes a home with the deploy directory and a stub docker that logs its
# arguments, and whether the deploy lock was free while it ran.
setup() {
  home="$(mktemp -d)"
  mkdir -p "$home/bin" "$home/app"
  echo "services: {}" > "$home/app/docker-compose.development.yml"
  cat > "$home/bin/docker" <<'STUB'
#!/bin/sh
echo "$*" >> "$HOME/calls"
if flock -n .deploy.lock true; then echo "unlocked" >> "$HOME/calls"; fi
STUB
  chmod +x "$home/bin/docker"
  # macOS has no flock; this shim skips the lock check there.
  if ! command -v flock >/dev/null; then
    cat > "$home/bin/flock" <<'STUB'
#!/bin/sh
[ "$1" = -n ] && exit 1
exit 0
STUB
    chmod +x "$home/bin/flock"
  fi
}

run() {
  env HOME="$home" PATH="$home/bin:$PATH" DEPLOY_DIR=app \
    COMPOSE_FILE=docker-compose.development.yml "$@" sh "$script" >/dev/null 2>&1
}

setup
if ! run IMAGE_NAME=ghcr.io/o/r IMAGE_DIGEST="$digest" TRUSTED_PROXY_IPS=10.0.0.0/8; then
  fail "deploy-remote.sh failed on valid input"
fi
if [[ "$(cat "$home/calls" 2>/dev/null)" != $'compose pull\ncompose up -d' ]]; then
  fail "docker calls = '$(cat "$home/calls" 2>/dev/null)', want pull then up, each under the lock"
fi
want="IMAGE_NAME='ghcr.io/o/r'
IMAGE_DIGEST='${digest}'
TRUSTED_PROXY_IPS='10.0.0.0/8'"
if [[ "$(cat "$home/app/.env")" != "$want" ]]; then
  fail ".env = '$(cat "$home/app/.env")', want '${want}'"
fi
if ! cmp -s "$home/app/docker-compose.yml" "$home/app/docker-compose.development.yml"; then
  fail "docker-compose.yml is not a copy of COMPOSE_FILE"
fi
rm -rf "$home"

setup
if run IMAGE_NAME=ghcr.io/o/r IMAGE_DIGEST=latest TRUSTED_PROXY_IPS=; then
  fail "deploy-remote.sh accepted a digest that is not sha256:"
fi
if [[ -e "$home/calls" ]]; then
  fail "docker ran after a bad digest"
fi
rm -rf "$home"

setup
if run IMAGE_NAME="ghcr.io/o/r'" IMAGE_DIGEST="$digest" TRUSTED_PROXY_IPS=; then
  fail "deploy-remote.sh accepted a value with a single quote"
fi
rm -rf "$home"

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi
echo "deploy-remote.sh: ok"
