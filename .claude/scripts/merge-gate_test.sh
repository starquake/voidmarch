#!/usr/bin/env bash
# merge-gate_test.sh: runs merge-gate.sh against a stub gh that answers from
# files, and checks its verdict and what it says.
set -uo pipefail

script="$(cd "$(dirname "$0")" && pwd)/merge-gate.sh"
head_sha=1111111111111111111111111111111111111111
old_sha=2222222222222222222222222222222222222222
failed=0

fail() {
  echo "FAIL: $*" >&2
  failed=1
}

# setup: a stub gh answering from files in $stub, filled with a plain PR by
# starquake-bot that changes a.go. A file holding ERROR makes that call fail.
setup() {
  stub="$(mktemp -d)"
  cat > "$stub/gh" << 'STUB'
#!/bin/sh
echo "gh $*" >> "$STUB/calls"
answer() {
  [ -f "$STUB/$1" ] || exit 1
  [ "$(cat "$STUB/$1")" != ERROR ] || exit 1
  cat "$STUB/$1"
  exit 0
}
case "$*" in
  "api graphql"*) answer pr.json ;;
  *"/contents/.github/CODEOWNERS"*) answer codeowners ;;
  *"/pulls/"*"/files"*) answer files.json ;;
esac
exit 1
STUB
  chmod +x "$stub/gh"
  pr '{}'
  printf '%s\n' '# owners' '/.github/ @starquake' '/CLAUDE.md @starquake' > "$stub/codeowners"
  files a.go
}

# pr OVERRIDES: the PR, with the JSON object OVERRIDES merged over the plain one.
pr() {
  jq -n --arg head "$head_sha" --argjson over "$1" '{data: {repository: {pullRequest: ({
    state: "OPEN", headRefOid: $head, baseRefName: "main", changedFiles: 1,
    reviewDecision: null, body: "",
    author: {__typename: "User", login: "starquake-bot"},
    headRepository: {nameWithOwner: "starquake/voidmarch"},
    labels: {nodes: []}, reviews: {nodes: []}} + $over)}}}' > "$stub/pr.json"
}

# files PATH...: the PR changes these files.
files() {
  printf '%s\n' "$@" | jq -R '{filename: .}' | jq -s . > "$stub/files.json"
}

approved_at() {
  printf '{"reviews": {"nodes": [{"state": "%s", "commit": {"oid": "%s"}}]}}' "$1" "$2"
}

# run [ARGS...]: runs the script with the stub first on PATH; sets $status.
run() {
  env STUB="$stub" PATH="$stub:$PATH" bash "$script" "${@-7}" > "$stub/out" 2>&1
  status=$?
}

# want NAME STATUS [LINE...]: fails NAME unless the exit status is STATUS and
# the output has each LINE (a grep -E pattern).
want() {
  local name="$1" want_status="$2" line
  shift 2
  if [[ "$status" -ne "$want_status" ]]; then
    fail "$name: exit $status, want $want_status: $(cat "$stub/out")"
  fi
  for line in "$@"; do
    if ! grep -Eq -- "$line" "$stub/out"; then
      fail "$name: no line matching '$line' in: $(cat "$stub/out")"
    fi
  done
}

# want_not NAME LINE: fails NAME if the output has LINE.
want_not() {
  if grep -Eq -- "$2" "$stub/out"; then
    fail "$1: unexpected '$2' in: $(cat "$stub/out")"
  fi
}

setup
run
want plain 0 "^head: $head_sha\$" '^verdict: merge$'
want_not plain '^sensitive:'

setup
run x
want usage 2

setup
echo ERROR > "$stub/pr.json"
run
want "PR read fails" 1 '^hold: could not read #7' '^verdict: hold$'

setup
pr '{"state": "MERGED"}'
run
want closed 1 '^hold: #7 is MERGED'

setup
pr '{"author": {"__typename": "Bot", "login": "dependabot"}}'
run
want dependabot 0 '^verdict: merge$'

for author in '"User", "login": "starquake"' '"User", "login": "someone"' '"Bot", "login": "starquake-bot"' \
  '"User", "login": "dependabot"'; do
  setup
  pr "{\"author\": {\"__typename\": $author}}"
  run
  want "author $author" 1 '^sensitive: opened by ' "^hold: needs @starquake's approval"
done

setup
pr '{"author": null}'
run
want "no author" 1 '^sensitive: opened by '

setup
pr '{"headRepository": {"nameWithOwner": "someone/voidmarch"}}'
run
want fork 1 "^sensitive: its branch is in 'someone/voidmarch'"

setup
pr '{"headRepository": null}'
run
want "deleted fork" 1 "^sensitive: its branch is in ''"

setup
files .github/workflows/ci.yml
run
want "owned directory" 1 '^sensitive: .github/workflows/ci.yml is in CODEOWNERS' \
  "^hold: needs @starquake's approval of $head_sha"

setup
files .github/workflows/ci.yml
pr "$(approved_at APPROVED "$head_sha")"
run
want "approved at head" 0 "^approved: @starquake approved $head_sha" '^verdict: merge$'

setup
files .github/workflows/ci.yml
pr "$(approved_at APPROVED "$old_sha")"
run
want "approved at an older commit" 1 "^hold: needs @starquake's approval"

setup
files .github/workflows/ci.yml
pr "$(approved_at DISMISSED "$head_sha")"
run
want "approval dismissed" 1 "^hold: needs @starquake's approval"

setup
files CLAUDE.md
run
want "anchored file" 1 '^sensitive: CLAUDE.md is in CODEOWNERS'

setup
files frontend/CLAUDE.md
run
want "anchored file elsewhere" 0
want_not "anchored file elsewhere" '^sensitive:'

setup
printf '%s\n' 'CLAUDE.md @starquake' > "$stub/codeowners"
files frontend/CLAUDE.md
run
want "bare name anywhere" 1 '^sensitive: frontend/CLAUDE.md is in CODEOWNERS'

setup
printf '%s\n' 'CLAUDE.md @starquake' > "$stub/codeowners"
files frontend/NOTCLAUDE.md
run
want "bare name is the whole name" 0

setup
printf '%s\n' '/deployments @starquake' > "$stub/codeowners"
files deployments/swag.conf
run
want "anchored name covers what is under it" 1 '^sensitive: deployments/swag.conf is in CODEOWNERS'

setup
printf '%s\n' '/deployments @starquake' > "$stub/codeowners"
files deployments-old.txt
run
want "anchored name is the whole name" 0

for pattern in '*.yml' '/docs/*' 'docs/' 'docs/x.md' '/a?b' '/[ab]' '/a\ b' '!x' '/' '/a//b'; do
  setup
  printf '%s @starquake\n' "$pattern" > "$stub/codeowners"
  run
  want "pattern $pattern" 1 "^sensitive: CHECK FAILED: CODEOWNERS pattern"
done

setup
printf '%s\n' '# nothing' '' > "$stub/codeowners"
run
want "no patterns" 1 '^sensitive: CHECK FAILED: CODEOWNERS has no patterns'

setup
echo ERROR > "$stub/codeowners"
run
want "CODEOWNERS read fails" 1 '^sensitive: CHECK FAILED: could not read'

setup
echo ERROR > "$stub/files.json"
run
want "files read fails" 1 "^sensitive: CHECK FAILED: could not read #7's files"

setup
pr '{"changedFiles": 2}'
run
want "files cut short" 1 '^sensitive: CHECK FAILED: read fewer files'

setup
printf '%s\n' '[{"filename": "a.go", "previous_filename": ".github/old.yml"}]' > "$stub/files.json"
run
want "renamed out of an owned path" 1 '^sensitive: .github/old.yml is in CODEOWNERS'

setup
pr '{"reviewDecision": "REVIEW_REQUIRED"}'
run
want "review required" 1 '^sensitive: GitHub says a review is required'

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi
echo "merge-gate_test.sh: ok"
