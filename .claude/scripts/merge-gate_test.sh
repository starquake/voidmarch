#!/usr/bin/env bash
# merge-gate_test.sh: runs merge-gate.sh against a stub gh that answers from
# files, and checks its verdict and what it says.
set -uo pipefail

script="$(cd "$(dirname "$0")" && pwd)/merge-gate.sh"
old_sha=2222222222222222222222222222222222222222
failed=0

fail() {
  echo "FAIL: $*" >&2
  failed=1
}

# setup: a stub gh answering from files in $stub, filled with a plain PR by
# starquake-bot that changes a.go, reviewed at its head. A file holding ERROR
# makes that call fail.
setup() {
  stub="$(mktemp -d)"
  work=""
  head_sha=1111111111111111111111111111111111111111
  cat > "$stub/gh" << 'STUB'
#!/bin/sh
echo "gh $*" >> "$STUB/calls"
answer() {
  [ -f "$STUB/$1" ] || exit 1
  [ "$(cat "$STUB/$1")" != ERROR ] || exit 1
  cat "$STUB/$1"
  exit 0
}
args="$*"
case "$args" in
  "api graphql"*) answer pr.json ;;
  *"/contents/.github/CODEOWNERS"*) answer codeowners ;;
  *"/pulls/"*"/files"*) answer files.json ;;
  *"/pulls/"*"/commits"*) answer commits.json ;;
  *"/commits/"*) answer "commit-${args##*/commits/}.json" ;;
  *"/rulesets/24078077") answer ruleset.json ;;
  *"/rulesets") answer rulesets.json ;;
esac
exit 1
STUB
  chmod +x "$stub/gh"
  echo '[{"id": 9, "name": "tags"}, {"id": 24078077, "name": "main"}]' > "$stub/rulesets.json"
  ruleset active true
  pr '{}'
  printf '%s\n' '# owners' '/.github/ @starquake' '/CLAUDE.md @starquake' > "$stub/codeowners"
  files a.go
  echo '[{"sha": "d1", "author": {"login": "dependabot[bot]"}}]' > "$stub/commits.json"
}

# reviewed_body SHA [HEADING]: a PR body recording a review of SHA under HEADING.
reviewed_body() {
  printf '## Where to look\n\nNothing.\n\n## %s\n\nReviewed at %s. None found.\n' \
    "${2:-Found in review}" "$1" | jq -Rs '{body: .}'
}

# pr OVERRIDES: the PR, with the JSON object OVERRIDES merged over the plain one.
pr() {
  jq -n --arg head "$head_sha" --argjson over "$1" '{data: {repository: {pullRequest: ({
    state: "OPEN", headRefOid: $head, baseRefName: "main", changedFiles: 1,
    reviewDecision: null, body: "## Found in review\n\nReviewed at \($head).\n",
    author: {__typename: "User", login: "starquake-bot"},
    headRepository: {nameWithOwner: "starquake/voidmarch"},
    labels: {nodes: []}, reviews: {nodes: []}} + $over)}}}' > "$stub/pr.json"
}

# ruleset ENFORCEMENT CODE_OWNER: the live ruleset main.
ruleset() {
  jq -n --arg e "$1" --argjson c "$2" '{name: "main", enforcement: $e, rules: [
    {type: "deletion"},
    {type: "pull_request", parameters: {required_approving_review_count: 0, require_code_owner_review: $c}}]}' \
    > "$stub/ruleset.json"
}

# files PATH...: the PR changes these files.
files() {
  printf '%s\n' "$@" | jq -R '{filename: .}' | jq -s . > "$stub/files.json"
}

approved_at() {
  printf '{"reviews": {"nodes": [{"state": "%s", "commit": {"oid": "%s"}}]}}' "$1" "$2"
}

# gitrepos: a bare origin whose main has one commit, a clone of it in $work
# for the script to run in, and $seed to make commits in and push from.
gitrepos() {
  local g
  g="$(mktemp -d)"
  seed="$g/seed"
  work="$g/work"
  git init -q -b main "$seed"
  commit base.txt base
  git clone -q --bare "$seed" "$g/origin.git"
  git -C "$g/origin.git" config uploadpack.allowAnySHA1InWant true
  sg remote add origin "$g/origin.git"
  git clone -q "$g/origin.git" "$work"
}

sg() {
  git -C "$seed" -c user.name=test -c user.email=test@example.com -c commit.gpgsign=false "$@"
}

# commit FILE TEXT: writes TEXT to FILE in $seed and commits it.
commit() {
  echo "$2" > "$seed/$1"
  sg add "$1"
  sg commit -q -m "Write $2 to $1"
}

# push_pr: pushes $seed's HEAD as PR 7's head, and points the PR at it.
push_pr() {
  sg push -q --force origin "HEAD:refs/pull/7/head"
  head_sha="$(sg rev-parse HEAD)"
}

# run [ARGS...]: runs the script with the stub first on PATH, in $work if it
# is set; sets $status.
run() {
  (cd "${work:-$stub}" && env STUB="$stub" PATH="$stub:$PATH" bash "$script" "${@-7}") > "$stub/out" 2>&1
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
pr '{"labels": {"nodes": [{"name": "dependencies"}, {"name": "hold"}]}}'
run
want "labeled hold" 1 '^hold: #7 is labeled hold'

setup
pr '{"labels": {"nodes": [{"name": "dependencies"}]}}'
run
want "other labels" 0

setup
pr "$(approved_at CHANGES_REQUESTED "$head_sha")"
run
want "changes requested" 1 '^hold: @starquake requested changes'

setup
files .github/workflows/ci.yml
pr "$(approved_at CHANGES_REQUESTED "$head_sha")"
run
want "changes requested on a sensitive PR" 1 '^hold: @starquake requested changes'

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

owned_here=(.github/workflows/ci.yml deployments/podman/deploy.sh .claude/skills/merge-pr/SKILL.md .mcp.json
  CLAUDE.md frontend/src/CLAUDE.md Makefile .golangci.yml .testcoverage.yml Dockerfile
  frontend/eslint.config.js frontend/tsconfig.json frontend/playwright.config.ts)
setup
cp "$(dirname "$script")/../../.github/CODEOWNERS" "$stub/codeowners"
files "${owned_here[@]}" internal/sim/sim.go tools/go.mod frontend/src/main.ts
pr "{\"changedFiles\": $((${#owned_here[@]} + 3))}"
run
want "this repository's CODEOWNERS" 1
want_not "this repository's CODEOWNERS" 'CHECK FAILED'
for f in "${owned_here[@]}"; do
  want "this repository's CODEOWNERS owns $f" 1 "^sensitive: $f is in CODEOWNERS"
done
want_not "this repository's CODEOWNERS" '^sensitive: (internal/sim|tools|frontend/src/main)'

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

setup
ruleset active false
run
want "ruleset without code owners" 1 "^sensitive: the live ruleset main does not require a code owner's review"

setup
ruleset disabled true
run
want "ruleset not enforced" 1 "^sensitive: the live ruleset main does not require"

setup
ruleset active true
pr "$(approved_at APPROVED "$head_sha")"
ruleset active false
run
want "ruleset loosened, approved" 0 "^approved: "

setup
echo '{"name": "main", "enforcement": "active", "rules": []}' > "$stub/ruleset.json"
run
want "ruleset without a pull request rule" 1 "^sensitive: the live ruleset main does not require"

setup
echo ERROR > "$stub/rulesets.json"
run
want "rulesets read fails" 1 '^sensitive: could not read the live ruleset main'

setup
echo '[{"id": 9, "name": "tags"}]' > "$stub/rulesets.json"
run
want "no ruleset main" 1 '^sensitive: could not read the live ruleset main'

setup
echo '[{"id": 24078077, "name": "main"}, {"id": 5, "name": "main"}]' > "$stub/rulesets.json"
run
want "two rulesets main" 1 '^sensitive: could not read the live ruleset main'

setup
echo ERROR > "$stub/ruleset.json"
run
want "ruleset read fails" 1 '^sensitive: could not read the live ruleset main'

# The review covers the head.

setup
run
want "reviewed at the head" 0 "^reviewed: $head_sha covers $head_sha"

setup
pr '{"body": ""}'
run
want "no review" 1 "^hold: no 'Reviewed at <sha>' under Found in review"

setup
pr "$(reviewed_body "$head_sha" "Where to look again")"
run
want "review line in another section" 1 "^hold: no 'Reviewed at <sha>'"

setup
pr "$(printf '## Found in review\n\nReviewed at `%s`.\n' "$head_sha" | jq -Rs '{body: .}')"
run
want "review line in backticks" 0 "^reviewed: "

setup
pr "$(printf '## Found in review\n\nReviewed at %s.\n\nReviewed at %s.\n' "$old_sha" "$head_sha" | jq -Rs '{body: .}')"
run
want "the last review line counts" 0 "^reviewed: $head_sha"

setup
gitrepos
sg checkout -q -b feature
commit a.txt one
commit b.txt two
push_pr
reviewed="$head_sha"
sg checkout -q main
commit m.txt main
sg push -q origin main
sg checkout -q feature
sg rebase -q main
push_pr
pr "$(reviewed_body "$reviewed")"
run
want "rebased onto a newer main" 0 "^reviewed: $reviewed covers $head_sha"

setup
gitrepos
sg checkout -q -b feature
commit a.txt one
push_pr
reviewed="$head_sha"
commit b.txt two
push_pr
pr "$(reviewed_body "$reviewed")"
run
want "new commit after the review" 1 "^hold: $head_sha is not $reviewed or only a rebase of it"

setup
gitrepos
sg checkout -q -b feature
commit a.txt one
push_pr
reviewed="$head_sha"
echo changed > "$seed/a.txt"
sg commit -q -a --amend --no-edit
push_pr
pr "$(reviewed_body "$reviewed")"
run
want "commit changed after the review" 1 "^hold: $head_sha is not $reviewed"

setup
gitrepos
sg checkout -q -b feature
commit a.txt one
push_pr
pr "$(reviewed_body 3333333333333333333333333333333333333333)"
run
want "reviewed commit unknown" 1 "^hold: $head_sha is not 3333333333333333333333333333333333333333"

setup
pr "$(reviewed_body "$old_sha")"
run
want "no checkout to compare in" 1 "^hold: $head_sha is not $old_sha"

# Dependabot.

setup
pr '{"author": {"__typename": "Bot", "login": "dependabot"}, "body": ""}'
run
want "dependabot's commits" 0 "^reviewed: only Dependabot's commits"

setup
pr '{"author": {"__typename": "Bot", "login": "dependabot"}, "body": ""}'
echo '[{"sha": "d1", "author": {"login": "dependabot[bot]"}}, {"sha": "c2", "author": {"login": "starquake-bot"}}]' \
  > "$stub/commits.json"
echo '{"files": [{"filename": "internal/web/static/js/game.js"}, {"filename": "THIRD-PARTY.md"}]}' \
  > "$stub/commit-c2.json"
run
want "dependabot with a rebuilt bundle" 0 "^reviewed: only Dependabot's commits and regenerated output"

setup
pr '{"author": {"__typename": "Bot", "login": "dependabot"}, "body": ""}'
echo '[{"sha": "c2", "author": null}]' > "$stub/commits.json"
echo '{"files": [{"filename": "internal/web/static/js/game.js"}, {"filename": "Makefile"}]}' \
  > "$stub/commit-c2.json"
run
want "dependabot with a hand edit" 1 "^hold: no 'Reviewed at <sha>'"

setup
pr '{"author": {"__typename": "Bot", "login": "dependabot"}, "body": ""}'
echo ERROR > "$stub/commits.json"
run
want "dependabot commits read fails" 1 "^hold: no 'Reviewed at <sha>'"

setup
pr '{"author": {"__typename": "Bot", "login": "dependabot"}, "body": ""}'
echo '[{"sha": "c2", "author": {"login": "starquake-bot"}}]' > "$stub/commits.json"
run
want "dependabot commit read fails" 1 "^hold: no 'Reviewed at <sha>'"

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi
echo "merge-gate_test.sh: ok"
