#!/usr/bin/env bash
# dispatch-after-merge_test.sh: runs dispatch-after-merge.sh against a stub gh
# that answers from scripted lists, and checks what it dispatches.
set -uo pipefail

script="$(cd "$(dirname "$0")" && pwd)/dispatch-after-merge.sh"
ci_url="https://github.com/starquake/voidmarch/actions/runs/123"
deploy_ci="gh workflow run ci.yml --ref main"
deploy_dev="gh workflow run deploy.yml --ref main -f environment=development"
failed=0

fail() {
  echo "FAIL: $*" >&2
  failed=1
}

# setup PR_ANSWERS RUN_ANSWERS: a stub gh whose `pr view` and `run view` print
# the next line of each list, the last one again once the list runs out. A line
# ERROR makes that call fail.
setup() {
  stub="$(mktemp -d)"
  printf '%s\n' "$1" | tr ',' '\n' > "$stub/pr"
  printf '%s\n' "$2" | tr ',' '\n' > "$stub/run"
  cat > "$stub/gh" <<'STUB'
#!/bin/sh
echo "gh $*" >> "$STUB/calls"
next() {
  line="$(head -n 1 "$STUB/$1")"
  if [ "$(wc -l < "$STUB/$1")" -gt 1 ]; then
    tail -n +2 "$STUB/$1" > "$STUB/$1.tmp" && mv "$STUB/$1.tmp" "$STUB/$1"
  fi
  [ "$line" != ERROR ] || exit 1
  echo "$line"
}
case "$1 $2 $3" in
  "pr view"*) next pr ;;
  "run view"*) next run ;;
  "workflow run ci.yml") echo "$CI_URL" ;;
  "workflow run deploy.yml") echo "https://github.com/starquake/voidmarch/actions/runs/456" ;;
  *) exit 1 ;;
esac
STUB
  chmod +x "$stub/gh"
  touch "$stub/calls"
}

# run [VAR=value...] -- ARGS...: runs the script with the stub first on PATH.
run() {
  local vars=()
  while [[ "$1" != -- ]]; do
    vars+=("$1")
    shift
  done
  shift
  env STUB="$stub" PATH="$stub:$PATH" CI_URL="$ci_url" POLL_SECONDS=0 ${vars[@]+"${vars[@]}"} \
    bash "$script" "$@" > "$stub/out" 2>&1
}

# dispatched: the workflow runs the script started, one per line.
dispatched() {
  grep '^gh workflow run' "$stub/calls"
}

# want_dispatched NAME WANT: fails NAME unless the dispatches are WANT.
want_dispatched() {
  if [[ "$(dispatched)" != "$2" ]]; then
    fail "$1: dispatched '$(dispatched)', want '$2' ($(cat "$stub/out"))"
  fi
}

# A bot merge and a green CI run dispatch CI, then Deploy for development.
setup "OPEN false,MERGED true" "queued ,in_progress ,completed success"
if ! run -- 7; then
  fail "green: failed: $(cat "$stub/out")"
fi
want_dispatched green "$deploy_ci"$'\n'"$deploy_dev"
if [[ "$(grep -c '^gh pr view 7 ' "$stub/calls")" -ne 2 ]]; then
  fail "green: the PR was not checked until it merged: $(cat "$stub/calls")"
fi
if [[ "$(grep -c '^gh run view 123 ' "$stub/calls")" -ne 3 ]]; then
  fail "green: run 123 was not watched until it completed: $(cat "$stub/calls")"
fi
rm -rf "$stub"

# A failed gh call is one more wait, not the end.
setup "ERROR,MERGED true" "ERROR,completed success"
if ! run -- 7; then
  fail "flaky gh: failed: $(cat "$stub/out")"
fi
want_dispatched "flaky gh" "$deploy_ci"$'\n'"$deploy_dev"
rm -rf "$stub"

# A person's merge pushes as that person, which runs CI and deploys by itself.
setup "MERGED false" "completed success"
if ! run -- 7; then
  fail "person: failed: $(cat "$stub/out")"
fi
want_dispatched person ""
rm -rf "$stub"

setup "CLOSED false" "completed success"
if ! run -- 7; then
  fail "closed: failed: $(cat "$stub/out")"
fi
want_dispatched closed ""
rm -rf "$stub"

# Still open when the tries run out: auto-merge waits for a rebase, whose CI comes back here.
setup "OPEN false" "completed success"
if ! run MERGE_TRIES=3 -- 7; then
  fail "open: failed: $(cat "$stub/out")"
fi
want_dispatched open ""
if [[ "$(grep -c '^gh pr view' "$stub/calls")" -ne 3 ]]; then
  fail "open: checked the PR $(grep -c '^gh pr view' "$stub/calls") times, want 3"
fi
rm -rf "$stub"

# CI failing on main deploys nothing and fails the job.
setup "MERGED true" "in_progress ,completed failure"
if run -- 7; then
  fail "red: exited 0, want a failure"
fi
want_dispatched red "$deploy_ci"
rm -rf "$stub"

setup "MERGED true" "in_progress "
if run CI_TRIES=2 -- 7; then
  fail "slow: exited 0, want a failure"
fi
want_dispatched slow "$deploy_ci"
rm -rf "$stub"

# Without the run's address there is no run to wait for.
setup "MERGED true" "completed success"
if run CI_URL= -- 7; then
  fail "no run: exited 0, want a failure"
fi
want_dispatched "no run" "$deploy_ci"
rm -rf "$stub"

for args in "" "7x" "7 8"; do
  setup "MERGED true" "completed success"
  # shellcheck disable=SC2086 # split into arguments on purpose
  if run -- $args; then
    fail "usage '$args': exited 0, want a failure"
  fi
  if [[ -s "$stub/calls" ]]; then
    fail "usage '$args': called gh: $(cat "$stub/calls")"
  fi
  rm -rf "$stub"
done

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi
echo "dispatch-after-merge.sh: ok"
