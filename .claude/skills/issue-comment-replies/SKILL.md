---
name: issue-comment-replies
description: >
  Use whenever the user wants to catch up on or respond to Voidmarch's GitHub
  issue or PR comments: "check the issues for new comments", "any comments to
  reply to?", "catch up on the tickets", or a board pass finding an unanswered
  comment. Scans open and recently closed issues and PRs for comments not yet
  answered, decides which merit a reply, AUTO-POSTS low-risk factual replies
  and DRAFTS substantive ones for the maintainer's OK. Comments post as
  @starquake-bot, with no attribution line. Trigger even if the user doesn't
  say "skill".
---

You triage new comments on this repo's issues and PRs and answer the ones
that merit it. You post as @starquake-bot, Claude's own account, so the
author's name says who wrote it and no attribution line is needed. A public
comment is still hard to take back: split replies into *auto-post* (safe,
factual) and *draft for approval* (substantive, contestable). When unsure,
it's a draft.

Write the comment to a file and post with `gh issue comment <n> --body-file
<file>` (or `gh pr comment`): multi-line markdown breaks `--body "…"`
quoting.

## Step 1: find unanswered comments

**The author tells Claude's comments from the maintainer's**: Claude's are by
@starquake-bot, the maintainer's by @starquake. Before the bot (#373), Claude
posted through @starquake's account with a `> 🤖` line at the top, so a
@starquake comment created before 2026-11-27T21:00:00Z that starts with
`> 🤖` is Claude's too. Any later @starquake comment is the maintainer's,
whatever it starts with.

1. List candidate threads (open, and touched in the last ~2 weeks):
   `gh issue list --state all --limit 40 --json number,title,updatedAt,state`
   and the same for `gh pr list`.
2. Pull each thread: `gh issue view <n> --json title,body,comments`; each
   comment's author is `.author.login`.
3. **Unanswered** means a human comment (the maintainer's, or anyone else's)
   with no comment by Claude after it. Answer blocks and go signals on gated
   tickets belong to `work-the-board` / `design-slice`: fold those in there,
   don't just reply.
4. Skip bot noise (Dependabot's included), and threads where Claude's reply
   already came last.

Report what you found before replying: "thread → unanswered comment".

## Step 2: which merit a reply

Reply to a direct question, an @-mention, or a technical claim where a
code-grounded answer helps. Don't reply to acknowledgements ("thanks", "👍"),
restatements of recorded decisions, or anything only a specific person can
answer. Silence is a fine outcome.

## Step 3: auto-post or draft

- **Auto-post**: factual and grounded. What the code does, where something
  lives, "tracked in #NN", a status, a clarifying question back.
- **Draft for approval**: opinion, pushback, anything that could read as a
  **decision** (decisions are the maintainer's), or anything you're not sure
  of. Show each draft with its thread, and post only the approved ones.

## Step 4: write it

Read the relevant code first, and never answer from memory. The answer goes in
the **first line**; reasoning goes below. Link the file, issue or PR you cite.

Example (auto-post, factual):

```
No new sprite is drawn for it: the art rule (CLAUDE.md) allows only what
exists in Foozle's "Void" packs, recolored or tinted at most. The boss is a
pack ship with a red tint, committed under `internal/web/static/assets/`;
the ticket's *Art constraint* names the file.
```

## Guardrails

- Post only as @starquake-bot (`gh auth status` shows the active account),
  never as @starquake.
- Never run `gh auth switch`, and never approve a PR as any account.
- Never post a design decision, only grounded observations.
- Never write in the maintainer's own voice.
- Don't double-reply. Prefer a few high-value replies over covering every
  thread.
