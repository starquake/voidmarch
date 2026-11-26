#!/usr/bin/env bash
# dispatch-after-merge.sh PR: from dependabot-auto-merge.yml, once a Dependabot
# PR's own CI has passed. It waits for auto-merge to merge PR, dispatches CI on
# main, waits for that run and, when it passes, dispatches Deploy for
# development. Auto-merge merges as GITHUB_TOKEN, and neither that push nor a
# run GITHUB_TOKEN starts triggers a workflow; a dispatch does (#202).
#
# It reads from its environment:
#   GH_REPO, GH_TOKEN  the repository and the token gh uses
#   POLL_SECONDS       the wait between two checks; 15 unless set
#   MERGE_TRIES        checks of the PR before giving up; 40 (10 minutes) unless set
#   CI_TRIES           checks of the CI run before giving up; 240 (an hour) unless set
set -euo pipefail

die() {
  echo "error: $*" >&2
  exit 1
}

[[ $# -eq 1 && "$1" =~ ^[0-9]+$ ]] || die "usage: dispatch-after-merge.sh PR"
pr="$1"
poll="${POLL_SECONDS:-15}"
merge_tries="${MERGE_TRIES:-40}"
ci_tries="${CI_TRIES:-240}"

# A failed gh call counts as one more wait, so one API error doesn't skip a deploy.
merged_by_bot() {
  local state
  for _ in $(seq "$merge_tries"); do
    state="$(gh pr view "$pr" --json state,mergedBy -q '.state + " " + ((.mergedBy.is_bot // false) | tostring)')" || state=""
    case "$state" in
      "MERGED true") return 0 ;;
      MERGED*)
        echo "#${pr} was merged by a person, whose push runs CI and deploys by itself"
        return 1
        ;;
      CLOSED*)
        echo "#${pr} was closed without a merge"
        return 1
        ;;
    esac
    sleep "$poll"
  done
  # Auto-merge waits while main is ahead; the rebased PR's CI starts this again.
  echo "#${pr} did not merge in time"
  return 1
}

wait_for_run() {
  local run="$1" state
  for _ in $(seq "$ci_tries"); do
    state="$(gh run view "$run" --json status,conclusion -q '.status + " " + .conclusion')" || state=""
    case "$state" in
      "completed success") return 0 ;;
      completed*) die "CI run ${run} on main ended '${state#completed }', so development is not deployed" ;;
    esac
    sleep "$poll"
  done
  die "CI run ${run} on main did not finish in time, so development is not deployed"
}

if ! merged_by_bot; then
  exit 0
fi

out="$(gh workflow run ci.yml --ref main)"
echo "CI on main: ${out}"
[[ "$out" =~ /actions/runs/([0-9]+) ]] || die "gh workflow run printed no run address"
wait_for_run "${BASH_REMATCH[1]}"

gh workflow run deploy.yml --ref main -f environment=development
