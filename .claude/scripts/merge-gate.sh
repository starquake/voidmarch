#!/usr/bin/env bash
# merge-gate.sh PR: merge-pr's Step 1. It reads the pull request once, prints
# the head commit it checked, why the PR needs @starquake's approval, what
# holds it, and a verdict. A read that fails, or a CODEOWNERS line it can't
# parse, counts against the merge.
#
# It reads from its environment:
#   GH_REPO  the repository; starquake/voidmarch unless set
#
# Exit status: 0 for "verdict: merge", 1 for "verdict: hold", 2 for bad usage.
set -uo pipefail

repo="${GH_REPO:-starquake/voidmarch}"
if [[ $# -ne 1 || ! "$1" =~ ^[0-9]+$ ]]; then
  echo "usage: merge-gate.sh PR" >&2
  exit 2
fi
pr="$1"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

is_sensitive=0
is_held=0
sensitive() {
  echo "sensitive: $*"
  is_sensitive=1
}
hold() {
  echo "hold: $*"
  is_held=1
}
verdict() {
  if [[ "$is_held" -eq 1 ]]; then
    echo "verdict: hold"
    exit 1
  fi
  echo "verdict: merge"
  exit 0
}

# One read, so the head, the reviews and the labels belong together.
query='query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $n) {
    state headRefOid baseRefName changedFiles reviewDecision body
    author { __typename login }
    headRepository { nameWithOwner }
    labels(first: 100) { nodes { name } }
    reviews(author: "starquake", states: [APPROVED, CHANGES_REQUESTED, DISMISSED], last: 1) {
      nodes { state commit { oid } } }
  } } }'
if ! gh api graphql -f query="$query" -f owner="${repo%%/*}" -f name="${repo#*/}" -F n="$pr" \
  > "$tmp/pr.json" 2> /dev/null ||
  ! jq -e '.data.repository.pullRequest.headRefOid | strings' "$tmp/pr.json" > /dev/null 2>&1; then
  hold "could not read #$pr"
  verdict
fi
field() {
  jq -r ".data.repository.pullRequest | $1" "$tmp/pr.json"
}
head="$(field .headRefOid)"
echo "head: $head"
[[ "$(field .state)" == OPEN ]] || hold "#$pr is $(field .state)"
[[ "$(field 'any(.labels.nodes[]; .name == "hold")')" == false ]] || hold "#$pr is labeled hold"
[[ "$(field '.reviews.nodes[0].state // ""')" != CHANGES_REQUESTED ]] || hold "@starquake requested changes"

# The repository is public: anyone can open a PR and write its body.
author="$(field '.author.__typename + "/" + .author.login')"
head_repo="$(field '.headRepository.nameWithOwner // ""')"
if [[ "$head_repo" != "$repo" ]]; then
  sensitive "its branch is in '$head_repo', not $repo"
elif [[ "$author" != User/starquake-bot && "$author" != Bot/dependabot ]]; then
  sensitive "opened by ${author#*/}, not by starquake-bot or Dependabot"
fi

# CODEOWNERS knows more forms than these; anything else fails the check, so the
# PR counts as sensitive. "/x" is matched as GitHub does: x itself or under x/.
anchored=()
bare=()
codeowners_ok=1
check_failed() {
  sensitive "CHECK FAILED: $*"
  codeowners_ok=0
}
parse_codeowners() {
  local line p
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    p=""
    read -r p _ <<< "$line" || true
    [[ -z "$p" || "$p" == \#* ]] && continue
    case "$p" in
      *[\*\?\[\\!]* | / | *//*) check_failed "CODEOWNERS pattern '$p' is of a form this check doesn't know" ;;
      /*) anchored+=("${p#/}") ;;
      */*) check_failed "CODEOWNERS pattern '$p' is of a form this check doesn't know" ;;
      *) bare+=("$p") ;;
    esac
  done < "$1"
  if [[ ${#anchored[@]} -eq 0 && ${#bare[@]} -eq 0 ]]; then
    check_failed "CODEOWNERS has no patterns"
  fi
}
owned() {
  local p
  for p in ${anchored[@]+"${anchored[@]}"}; do
    case "$p" in
      */) [[ "$1" == "$p"* ]] && return 0 ;;
      *) [[ "$1" == "$p" || "$1" == "$p"/* ]] && return 0 ;;
    esac
  done
  for p in ${bare[@]+"${bare[@]}"}; do
    [[ "$1" == "$p" || "$1" == */"$p" || "$1" == "$p"/* || "$1" == */"$p"/* ]] && return 0
  done
  return 1
}

base="$(field .baseRefName)"
if ! gh api -H "Accept: application/vnd.github.raw+json" \
  "repos/$repo/contents/.github/CODEOWNERS?ref=$base" > "$tmp/codeowners" 2> /dev/null; then
  check_failed "could not read $base's .github/CODEOWNERS"
else
  parse_codeowners "$tmp/codeowners"
fi
if [[ "$codeowners_ok" -eq 1 ]]; then
  if ! gh api --paginate "repos/$repo/pulls/$pr/files?per_page=100" > "$tmp/files.json" 2> /dev/null ||
    ! jq -r '.[] | .filename, (.previous_filename // empty)' "$tmp/files.json" > "$tmp/files" 2> /dev/null; then
    check_failed "could not read #$pr's files"
  elif [[ "$(jq -s 'map(length) | add // 0' "$tmp/files.json")" != "$(field .changedFiles)" ]]; then
    # The files endpoint stops at 3000.
    check_failed "read fewer files than #$pr changes"
  else
    while IFS= read -r f; do
      if owned "$f"; then sensitive "$f is in CODEOWNERS"; fi
    done < "$tmp/files"
  fi
fi
[[ "$(field '.reviewDecision // ""')" == REVIEW_REQUIRED ]] && sensitive "GitHub says a review is required"

# Until the live ruleset requires a code owner, nothing makes GitHub stop a
# sensitive PR that this check missed.
ruleset_id="$(gh api "repos/$repo/rulesets" 2> /dev/null |
  jq -r '[.[] | select(.name == "main")] | if length == 1 then .[0].id else empty end' 2> /dev/null)"
if [[ ! "$ruleset_id" =~ ^[0-9]+$ ]] ||
  ! gh api "repos/$repo/rulesets/$ruleset_id" > "$tmp/ruleset.json" 2> /dev/null; then
  sensitive "could not read the live ruleset main"
elif [[ "$(jq -r '.enforcement == "active" and
  any(.rules[]; .type == "pull_request" and .parameters.require_code_owner_review == true)' \
  "$tmp/ruleset.json" 2> /dev/null)" != true ]]; then
  sensitive "the live ruleset main does not require a code owner's review"
fi

if [[ "$is_sensitive" -eq 1 ]]; then
  if [[ "$(field '.reviews.nodes[0].state // ""')" == APPROVED &&
    "$(field '.reviews.nodes[0].commit.oid // ""')" == "$head" ]]; then
    echo "approved: @starquake approved $head"
  else
    hold "needs @starquake's approval of $head"
  fi
  verdict
fi

# A rebase changes the commits but not their patches. Each side of the
# range-diff runs from where that commit leaves the base branch. Sets $why
# when it fails.
covers_head() {
  local reviewed="$1" old_base new_base diff
  why=""
  [[ "$reviewed" == "$head" ]] && return 0
  why="could not fetch or compare the commits"
  git fetch --quiet origin "+refs/heads/$base:refs/remotes/origin/$base" "refs/pull/$pr/head" 2> /dev/null ||
    return 1
  git cat-file -e "$reviewed^{commit}" 2> /dev/null ||
    git fetch --quiet origin "$reviewed" 2> /dev/null || return 1
  old_base="$(git merge-base "origin/$base" "$reviewed" 2> /dev/null)" || return 1
  new_base="$(git merge-base "origin/$base" "$head" 2> /dev/null)" || return 1
  # range-diff skips merge commits, so a merge could add code unseen.
  if [[ -n "$(git rev-list --merges "$old_base..$reviewed" 2> /dev/null)$(git rev-list --merges "$new_base..$head" 2> /dev/null)" ]]; then
    why="a merge commit, which range-diff can't compare"
    return 1
  fi
  why="no commits to compare"
  [[ -n "$(git rev-list "$old_base..$reviewed" 2> /dev/null)" ]] || return 1
  why="could not compare the commits"
  diff="$(git range-diff --no-color "$old_base..$reviewed" "$new_base..$head" 2> /dev/null)" || return 1
  [[ -n "$diff" ]] || return 1
  why="a commit's patch changed, or a commit was added or dropped"
  grep -Ev '^ *[0-9]+: +[0-9a-f]+ = +[0-9]+: +[0-9a-f]+( |$)' <<< "$diff" | grep -q . && return 1
  # range-diff calls two binary files the same if both differ, and misses a
  # mode, so each pair's modes and blobs must match too.
  why="a pair of commits differs in its modes or blobs (a binary, a mode, or a file main changed too)"
  local old new old_raw new_raw
  while read -r _ old _ _ new _; do
    old_raw="$(git diff-tree -r --raw --no-abbrev --no-commit-id "$old" 2> /dev/null)" &&
      new_raw="$(git diff-tree -r --raw --no-abbrev --no-commit-id "$new" 2> /dev/null)" &&
      [[ -n "$old_raw" && "$old_raw" == "$new_raw" ]] || return 1
  done <<< "$diff"
}

# Dependabot's own commits need no review, nor Claude's that only regenerate
# output. Only output a CI check fails on when a file is changed, added or
# missing: js-check and proto-check (diff -r), wasm-check (cmp of each file),
# third-party-check (diff).
regenerated() {
  case "$1" in
    *..*) return 1 ;;
    internal/web/static/js/* | frontend/src/bootsizes.gen.ts | \
      internal/web/static/wasm/sim.wasm | internal/web/static/wasm/wasm_exec.js | \
      frontend/src/sim/rules.gen.ts | internal/gen/* | frontend/src/gen/* | THIRD-PARTY.md) return 0 ;;
  esac
  return 1
}
needs_review() {
  local sha f
  [[ "$author" == Bot/dependabot ]] || return 0
  # Dependabot's own commits are committed by GitHub (web-flow) and signed; an
  # author alone survives a rebase or an amend by anyone.
  gh api --paginate "repos/$repo/pulls/$pr/commits?per_page=100" > "$tmp/commits.json" 2> /dev/null &&
    jq -r '.[] | select((.author.login == "dependabot[bot]" and
      (.committer.login == "web-flow" or .committer.login == "dependabot[bot]") and
      .commit.verification.verified == true) | not) | .sha' "$tmp/commits.json" \
      > "$tmp/others" 2> /dev/null || return 0
  while IFS= read -r sha; do
    # 300 files a page, and no more than 3000 in all.
    gh api --paginate "repos/$repo/commits/$sha" > "$tmp/commit.json" 2> /dev/null &&
      jq -r '.files[] | .filename, (.previous_filename // empty)' "$tmp/commit.json" \
        > "$tmp/commit-files" 2> /dev/null || return 0
    [[ "$(jq -s 'map(.files | length) | add // 0' "$tmp/commit.json")" -lt 3000 ]] || return 0
    while IFS= read -r f; do
      regenerated "$f" || return 0
    done < "$tmp/commit-files"
  done < "$tmp/others"
  return 1
}

if needs_review; then
  reviewed="$(field .body | tr -d '\r' |
    awk '/^## / { found = ($0 ~ /^## Found in review/) } found' |
    grep -oE 'Reviewed at `?[0-9a-f]{40}' | tail -n 1 | grep -oE '[0-9a-f]{40}')"
  if [[ -z "$reviewed" ]]; then
    hold "no 'Reviewed at <sha>' under Found in review: have a separate agent review it"
  elif covers_head "$reviewed"; then
    echo "reviewed: $reviewed covers $head"
  else
    hold "$head is not $reviewed or only a rebase of it ($why): have the new work reviewed"
  fi
else
  echo "reviewed: only Dependabot's commits and regenerated output"
fi
verdict
