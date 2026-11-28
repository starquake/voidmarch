---
name: merge-pr
description: >
  Use whenever a Voidmarch pull request should be merged or landed: "merge
  #NN", "land this PR", "merge the approved PRs", or a board pass finding a
  PR that @starquake approved. Runs this repo's merge checks: @starquake's
  approving review of the current head commit (the maintainer's approval;
  NEVER merge without it), green required checks, every review thread
  resolved, a title that still describes the diff, and a local rebase if
  behind, then squash-merges as @starquake-bot. Dependabot PRs merge
  themselves through a workflow, except those waiting for @starquake's
  approval, which land here like any other. Trigger for any merge
  request even if the user doesn't say "skill".
---

**A PR is mergeable only when @starquake has approved its current head
commit.** That review *is* the maintainer's approval: their "ask one last
time", given on GitHub. Without it you stop and say so. Claude works as
@starquake-bot and **never approves a PR**, its own or anyone else's.

**Never run `gh auth switch`, and never approve a PR as any account.**

**Dependabot's PRs mostly merge themselves.**
`.github/workflows/dependabot-auto-merge.yml` approves Dependabot's own pushes
and squash-merges them once the required checks pass. Never approve one. Two
kinds wait for @starquake's approval instead: one Claude pushed onto (a
rebase, a rebuilt bundle), and a direct bump in `/tools`. Once @starquake has
approved one, merge it here like any other PR. Keeping them mergeable is
`work-the-board`'s.

**Anything that becomes permanent at merge is verified AT merge**: a push
dismisses the approval, CI can go stale on a push, and the title can be
outrun by its own diff. Re-read all three at the last moment.

The ruleset (`.github/rulesets/main.json`) is what the merge must satisfy:
squash only, signed commits, linear history, one approving review (a later
push dismisses it), every review thread resolved, the branch up to date with
`main`, and the required checks `lint`, `build`, `e2e (chromium)`,
`e2e (firefox)` and `docker` green.

## Step 1: the approval

Re-read it from the API at merge time, never from a notification:

```bash
gh pr view <n> --json headRefOid,reviewDecision,reviews,mergeable,mergeStateStatus --jq '
  .headRefOid as $head
  | ([.reviews[] | select(.author.login == "starquake" and .state != "COMMENTED")] | last) as $r
  | {head: $head, approved: ($r.state == "APPROVED"), current: ($r.commit.oid == $head),
     decision: .reviewDecision, mergeable, state: .mergeStateStatus}'
```

Merge only when `approved` and `current` are both `true`: @starquake's latest
review is an approval, and it is for the commit the PR has now. **Write down
`head`**: it is the commit the approval covers, and Step 5 merges exactly that
commit. Replying to a
review thread makes a `COMMENTED` review, which neither gives nor takes away
an approval, so the filter skips those. `decision` reads `APPROVED` too once
the ruleset requires the review.

No approval, or one for an older commit? **STOP**, and tell the maintainer.
"Merge it" in chat without the approval means: say that it's missing, and
let them approve on GitHub or explicitly override.

## Step 2: CI must be green

```bash
gh pr checks <n>
```

Every check must pass, and it must belong to the PR's current head commit.
Never merge red or pending CI.

## Step 2b: every conversation resolved

The ruleset refuses to merge while a review conversation is unresolved
(starquake-recompiled#74).
A thread still open is a finding or a comment not yet acted on: act on it
first (`build-slice`, *Review the whole diff*), or ask the maintainer.

```bash
gh api graphql -f query='{ repository(owner:"starquake", name:"voidmarch") {
  pullRequest(number:<n>) { reviewThreads(first:50) { nodes { isResolved path line } } } } }' \
  --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not)]'
```

## Step 3: the title still describes the diff

The squash commit takes the PR title as its subject, permanently, so it is a
plain one-line capitalized subject like any commit:

```bash
gh pr view <n> --json title,files -q '.title + "\n" + ([.files[].path] | join("\n"))'
```

If the scope changed since the PR was opened, fix the title with
`gh pr edit <n> --title "…"`.

## Step 4: rebase if behind

The ruleset is strict, so a branch behind `main` does not merge. If
`mergeStateStatus` is `BEHIND`/`DIRTY` or `mergeable` is `CONFLICTING`, rebase
locally:

```bash
git fetch origin --quiet && git checkout <branch> && git rebase origin/main
make check          # the combined result must be green; add make test-e2e for the client
git push --force-with-lease
```

**Never merge `main` into the branch, and never `gh pr update-branch`** (or the
"Update branch" button): a server-side update makes unsigned commits, which the
ruleset blocks, and a merge commit breaks linear history. The local rebase
re-signs the commits with the local SSH key.

A force-push re-runs CI and dismisses the approval, so go back to Step 1: the
maintainer approves the new head before it merges.

## Step 5: merge

```bash
gh pr merge <n> --squash --match-head-commit <head from Step 1>
```

Pass the `head` Step 1 checked, never a fresh read of the PR's head: a fresh
read would merge a commit pushed after the check, which nobody approved.
`--match-head-commit` refuses the merge if the head moved since Step 1. You
merge as @starquake-bot, so the squash commit on `main` is the bot's, signed
by GitHub. The repo deletes merged branches automatically. Then:

- Update the local checkout: `git checkout main && git pull --ff-only`. Do
  this only if no agent is working in the shared checkout; the merge itself is
  server-side and never needs it.
- **Check every issue the merge closed still deserved closing.** Read its
  plan: if any task is unticked (a maintainer step counts), the `Closes` was
  wrong. Reopen it (`gh issue reopen <n>`), move it to the state of whoever
  holds that task, and post a Next-steps comment naming it
  (starquake-recompiled#22).
- **A sub-issue closed?** When it was its parent's last open sub-issue and
  every box in the parent's plan is ticked, close the parent too
  (`gh issue close <parent> --reason completed`); no PR does, since a PR closes
  only its own sub-issue.
- Otherwise the board's `Item closed → Done` workflow moves the card. Check
  that it did (`board.sh get <issue>`); if it didn't, move it and report that
  the workflow is off.
- **Wait for `main`'s own CI and read it.** A green PR does not guarantee a
  green `main`: a job that runs only on `main`, or a flake, can still fail
  there. If `main` is red, fixing it comes before anything else and does not
  need asking about.

  ```bash
  until [ "$(gh run list -R starquake/voidmarch --branch main --workflow CI --limit 1 --json status -q '.[0].status')" = "completed" ]; do sleep 30; done
  gh run list -R starquake/voidmarch --branch main --workflow CI --limit 1 --json conclusion,headSha
  ```

**Merging several:** one at a time, re-checking the next PR after each merge.
Merging one advances `main` and puts every other open PR behind it, which the
strict ruleset refuses: rebase the next one locally (Step 4), wait for its CI,
and wait for the maintainer to approve its new head before merging it.

If `gh pr merge` is refused by the permission classifier while the approval
is there and CI is green, re-read the approval and retry once. If the
approval is missing, that's a real stop.
