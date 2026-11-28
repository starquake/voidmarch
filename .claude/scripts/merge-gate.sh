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

if [[ "$is_sensitive" -eq 1 ]]; then
  if [[ "$(field '.reviews.nodes[0].state // ""')" == APPROVED &&
    "$(field '.reviews.nodes[0].commit.oid // ""')" == "$head" ]]; then
    echo "approved: @starquake approved $head"
  else
    hold "needs @starquake's approval of $head"
  fi
fi
verdict
