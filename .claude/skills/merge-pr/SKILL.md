---
name: merge-pr
description: >
  Use whenever a Voidmarch pull request should be merged or landed: "merge
  #NN", "land this PR", "merge the ready PRs", or a board pass finding a PR
  that is reviewed and green, or one that @starquake approved. Runs this
  repo's merge checks: for a PR touching a path in `.github/CODEOWNERS`,
  @starquake's approving review of the current head commit (NEVER merge one
  without it); for any other PR, the separate reviewer agent's review; then
  green required checks, every review thread resolved, a title that still
  describes the diff, and a local rebase if behind, then squash-merges as
  @starquake-bot. Most Dependabot PRs merge themselves through a workflow.
  Trigger for any merge request even if the user doesn't say "skill".
---

**Claude merges its own PRs once they are reviewed and green** (#373,
decision 8), **except a PR whose diff touches a sensitive path**: one that
`.github/CODEOWNERS` gives to @starquake (`.github/`, `deployments/`,
`CLAUDE.md`, `.claude/`). That one is mergeable only when @starquake has
approved its current head commit. Claude works as @starquake-bot and **never
approves a PR**, its own or anyone else's.

**Never run `gh auth switch`, and never approve a PR as any account.**

**Dependabot's PRs mostly merge themselves.**
`.github/workflows/dependabot-auto-merge.yml` turns on auto-merge for
Dependabot's own pushes, and GitHub squash-merges each once the required
checks pass. Never approve one. One that touches `.github/` (an actions bump,
or a `@playwright/test` bump once Claude moved `ci.yml`'s image tag) waits for
@starquake's approval as code owner, and auto-merge lands it once they give
it. A direct bump in `/tools` gets no auto-merge: once Claude has mirrored its
version into the Makefile's `GOLANGCI_VERSION` and CI is green, merge it here.
A Dependabot PR has no *Found in review*, so its gate is the rest of Step 1's
three things, unless Claude pushed more onto it than a rebase, regenerated
output or the pin: a separate agent reviews that first. Keeping them
mergeable is `work-the-board`'s.

**Anything that becomes permanent at merge is verified AT merge**: a push
dismisses an approval, CI can go stale on a push, and the title can be
outrun by its own diff. Re-read all three at the last moment.

The ruleset (`.github/rulesets/main.json`) is what the merge must satisfy:
squash only, signed commits, linear history, a code owner's approval when the
diff touches a path in `.github/CODEOWNERS` (a later push dismisses it) and no
other approval, every review thread resolved, the branch up to date with
`main`, and the required checks `lint`, `build`, `e2e (chromium)`,
`e2e (firefox)` and `docker` green.

## Step 1: which gate, and is it met

Re-read everything from the API at merge time, never from a notification.
`.claude/scripts/merge-gate.sh` does it in one read of the PR, and
`make test-scripts` tests it:

```bash
.claude/scripts/merge-gate.sh <n>
```

It prints `head: <sha>`, a `sensitive:` line for each reason the PR needs
@starquake's approval, a `hold:` line for each reason it must not merge now,
and `verdict: merge` (exit 0) or `verdict: hold` (exit 1). **Write down
`head`**: it is the commit the gate was checked on, and Step 5 merges exactly
that commit. On `verdict: hold`, **STOP** and tell the maintainer what the
`hold:` lines say.

A PR is **sensitive** when its diff touches a path `.github/CODEOWNERS` on
the base branch gives to an owner (a rename counts by both names), or when
GitHub's `reviewDecision` is `REVIEW_REQUIRED`. **So is every PR not opened
by @starquake-bot or Dependabot from a branch in this repository**: the
repository is public, so anyone can open a PR and write a *Found in review*
into its body. @starquake's own PRs count too, and wait for them. **And
every PR is sensitive while the live ruleset `main` does not require a code
owner's review** (`require_code_owner_review`, in an active ruleset), or
can't be read: before @starquake applies `.github/rulesets/main.json`, or
after anyone loosens it, nothing on GitHub would stop a sensitive PR this
check missed. The check **fails closed**:
it knows the CODEOWNERS forms `/dir/`, `/name` (that path and everything
under it, as GitHub reads it) and a bare `name` with no slash (that name at
any depth). Any other form, a CODEOWNERS with no patterns, or a failed read
prints `CHECK FAILED`, and the PR counts as sensitive.

**Any PR, sensitive or not, is held** while it is labeled `hold`, or while
@starquake's latest review that is not a plain comment requests changes.

**A sensitive PR needs @starquake's approval of `head`**: their latest review
that is not a plain comment is `APPROVED`, and for that commit. Replying to a
review thread makes a `COMMENTED` review, which neither gives nor takes away
an approval, so the check skips those. "Merge it" in chat without the
approval means: say that it's missing, and let them approve on GitHub or
explicitly override.

**Any other PR's gate is three things**, and no approval:

- **The separate reviewer agent's review is done**: the PR body's *Found in
  review* says a separate agent reviewed the whole branch (`build-slice`,
  *Review the whole diff*), and nothing but a rebase or regenerated output
  was pushed after it. No such section, or new work since? Have it reviewed
  first.
- **CI is green** for `head` (Step 2).
- **Every review thread is resolved** (Step 2b). A judgement call still
  waiting for @starquake's `fix`, `skip` or `ticket` holds the PR.

Then Claude merges it as @starquake-bot (Steps 3 to 5).

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
gh pr view <n> --json mergeable,mergeStateStatus
git fetch origin --quiet && git checkout <branch> && git rebase origin/main
make check          # the combined result must be green; add make test-e2e for the client
git push --force-with-lease
```

**Never merge `main` into the branch, and never `gh pr update-branch`** (or the
"Update branch" button): a server-side update makes unsigned commits, which the
ruleset blocks, and a merge commit breaks linear history. The local rebase
re-signs the commits with the local SSH key.

A force-push re-runs CI and dismisses an approval, so go back to Step 1 with
the new head: a sensitive PR waits for @starquake to approve it again.

## Step 5: merge

```bash
gh pr merge <n> --squash --match-head-commit <head from Step 1>
```

Pass the `head` Step 1 checked, never a fresh read of the PR's head: a fresh
read would merge a commit pushed after the check, which nobody reviewed or
approved.
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
and, if it is sensitive, wait for the maintainer to approve its new head
before merging it.

If `gh pr merge` is refused by the permission classifier while Step 1's gate
is met and CI is green, re-read the gate and retry once. If the gate is not
met (a missing approval, a review not done), that's a real stop.
