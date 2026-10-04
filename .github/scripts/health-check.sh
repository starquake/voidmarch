#!/usr/bin/env bash
# health-check.sh URL: waits up to a minute for URL to answer 2xx.
set -euo pipefail

for i in $(seq 1 12); do
  if curl -fsS "$1" >/dev/null; then
    echo "healthy after ${i} attempt(s)"
    exit 0
  fi
  sleep 5
done
echo "error: $1 not healthy after 60s" >&2
exit 1
