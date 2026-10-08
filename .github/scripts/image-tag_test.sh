#!/usr/bin/env bash
# image-tag_test.sh: checks image-tag.sh's answer for each environment and ref.
set -uo pipefail

script="$(dirname "$0")/image-tag.sh"
failed=0

expect() {
  local want="$1"
  shift
  local got
  if ! got="$("$script" "$@" 2>/dev/null)"; then
    got="error"
  fi
  if [[ "$got" != "$want" ]]; then
    echo "FAIL: image-tag.sh $* = '${got}', want '${want}'" >&2
    failed=1
  fi
}

expect "tag=edge" development main
expect "error" development ""
expect "error" development v1.0.0
expect "error" development v1.0.0-rc.1
expect "error" development feature

expect "tag=1.0.0-rc.1" staging v1.0.0-rc.1
expect "tag=12.3.40-rc.15" staging v12.3.40-rc.15
expect "error" staging ""
expect "error" staging main
expect "error" staging v1.0.0
expect "error" staging v1.0.0-rc
expect "error" staging v1.0.0-rc.1x
expect "error" staging v1.0.0-beta.1
expect "error" staging 1.0.0-rc.1

expect "tag=latest" production ""
expect "tag=1.0.0" production v1.0.0
expect "tag=2.10.3" production v2.10.3
expect "error" production v1.0.0-rc.1
expect "error" production v1.0
expect "error" production 1.0.0
expect "error" production main

expect "error" preview main
expect "error" staging
expect "error"

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi
echo "image-tag.sh: ok"
