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
      nodes { state submittedAt commit { oid } } }
    timelineItems(itemTypes: [REVIEW_DISMISSED_EVENT], last: 100) {
      pageInfo { hasPreviousPage }
      nodes { ... on ReviewDismissedEvent {
        createdAt actor { login } pullRequestCommit { id } review { author { login } } } } }
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
# The ruleset, and CODEOWNERS as GitHub reads it, protect main only.
[[ "$(field .baseRefName)" == main ]] || hold "#$pr merges into '$(field .baseRefName)', not main"
[[ "$(field 'any(.labels.nodes[]; .name == "hold")')" == false ]] || hold "#$pr is labeled hold"
[[ "$(field '.reviews.nodes[0].state // ""')" != CHANGES_REQUESTED ]] || hold "@starquake requested changes"
# Anyone with write access can dismiss a review. A push dismissing a stale
# approval names its commit; only @starquake's own review afterwards clears
# a dismissal by hand.
dismissed="$(field '[.timelineItems.nodes[] | select((.review == null or .review.author.login == "starquake")
  and .pullRequestCommit == null and .actor.login != "starquake") | .createdAt] | max // ""')"
if [[ "$(field .timelineItems.pageInfo.hasPreviousPage)" != false ]]; then
  hold "could not read every dismissed review on #$pr"
elif [[ -n "$dismissed" && ! "$(field '.reviews.nodes[0].submittedAt // ""')" > "$dismissed" ]]; then
  hold "a review by @starquake was dismissed by someone else at $dismissed"
fi

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
# A bare "x" or "x/" matches x at any depth, as a file or a directory, and case
# never matters: both match more than GitHub, never less.
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
      */) if [[ "${p%/}" == */* ]]; then
        check_failed "CODEOWNERS pattern '$p' is of a form this check doesn't know"
      else
        bare+=("${p%/}")
      fi ;;
      */*) check_failed "CODEOWNERS pattern '$p' is of a form this check doesn't know" ;;
      *) bare+=("$p") ;;
    esac
  done < "$1"
  if [[ ${#anchored[@]} -eq 0 && ${#bare[@]} -eq 0 ]]; then
    check_failed "CODEOWNERS has no patterns"
  fi
}
owned() {
  local p found=1
  shopt -s nocasematch
  for p in ${anchored[@]+"${anchored[@]}"}; do
    case "$p" in
      */) [[ "$1" == "$p"* ]] && found=0 ;;
      *) [[ "$1" == "$p" || "$1" == "$p"/* ]] && found=0 ;;
    esac
  done
  for p in ${bare[@]+"${bare[@]}"}; do
    [[ "$1" == "$p" || "$1" == */"$p" || "$1" == "$p"/* || "$1" == */"$p"/* ]] && found=0
  done
  shopt -u nocasematch
  return "$found"
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
elif [[ "$(jq -r '.target == "branch" and
  any(.conditions.ref_name.include[]?; . == "~DEFAULT_BRANCH" or . == "refs/heads/main") and
  ((.conditions.ref_name.exclude // []) | length == 0)' "$tmp/ruleset.json" 2> /dev/null)" != true ]]; then
  sensitive "the live ruleset main does not cover the main branch"
elif [[ "$(jq -r '.current_user_can_bypass' "$tmp/ruleset.json" 2> /dev/null)" != never ]]; then
  sensitive "the live ruleset main lets this account bypass it"
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
  why="a pair of commits differs in its modes, paths or binary files"
  local old new
  while read -r _ old _ _ new _; do
    pair_matches "$old" "$new" || return 1
  done <<< "$diff"
}

# pair_matches OLD NEW: range-diff calls any two binary changes the same and
# misses a mode, so both commits must touch the same paths with the same modes
# and statuses, and leave each binary file with the same blob. A text file's
# blob may differ, when main changed it too: range-diff compared its patch.
pair_matches() {
  local a b
  a="$(shape "$1")" && b="$(shape "$2")" && [[ -n "$a" && "$a" == "$b" ]] || return 1
  a="$(binary_blobs "$1")" && b="$(binary_blobs "$2")" && [[ "$a" == "$b" ]]
}
shape() {
  git diff-tree -r --raw --no-abbrev --no-renames --no-commit-id "$1" 2> /dev/null |
    sed -E 's/^(:[0-7]+ [0-7]+) [0-9a-f]+ [0-9a-f]+ /\1 /'
}
binary_blobs() {
  local rec path
  git diff --numstat --no-renames -z "$1^" "$1" > "$tmp/numstat" 2> /dev/null || return 1
  while IFS= read -r -d '' rec; do
    [[ "$rec" == $'-\t-\t'* ]] || continue
    path="${rec#$'-\t-\t'}"
    printf '%s %s\n' "$path" "$(git rev-parse -q --verify "$1:$path" 2> /dev/null || echo deleted)"
  done < "$tmp/numstat"
}

# Every PR that isn't sensitive needs a recorded review, Dependabot's too: a
# writer can make a commit that names dependabot[bot] as author.
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
verdict
