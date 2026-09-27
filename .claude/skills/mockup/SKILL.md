---
name: mockup
description: >
  Use whenever visual or looks-driven Voidmarch work needs its pre-approval
  mockup: "make a mockup of X", "show me what it would look like", "design the
  screen first", or from inside a spec whose value is how it LOOKS (a new
  screen, a HUD or layout change, colours, tints, typography, animation).
  Produces a screenshot of the running game (Playwright or the built-in
  browser pane), commits it under docs/mockups/ on the work branch, and embeds
  it in the ticket. The maintainer approves the picture BEFORE any real UI is
  built. Trigger before writing any UI code for looks-driven work, even if
  nobody asked for a mockup.
---

Visual work gets a mockup approved **before** the real UI exists. You produce
the mockup, the screenshot and the embed; the maintainer's yes to the picture
is part of the spec OK.

## Step 1: build it

Pick whichever shows the design fastest and most faithfully:

- **A real screenshot of the running game**, the default. Start the server
  with `make server` (it listens on :8080), then take it either way:
  - **Playwright** (`frontend/e2e`): drive the page into the state the design
    needs and `await page.screenshot({ path: … })`. For a page that needs no
    input, `npx playwright screenshot --viewport-size "1280,720"
    http://localhost:8080 <file>.png` is enough.
  - **The Claude desktop built-in browser pane**: `preview_start` on the
    `.claude/launch.json` configuration that runs `make server` on :8080, play
    into the state, and screenshot it.

  A screenshot shows the game as it is, so a change can be seen in place: a
  throwaway edit on the work branch (a tint, a pack sprite swapped in, a HUD
  element placed by hand) rendered in the running game, never kept as the
  build and never committed. Every sprite in the picture keeps to the art
  rule: Foozle's "Void" packs, recolored or tinted at most.
- **A sketch** (an HTML mockup in the scratchpad, never committed), only for
  UI that doesn't exist yet and can't be shown in the running game: a screen
  with no route to it, a menu not built. Say which it is, so nobody reads a
  sketch as the game. Use the pack's sprites in it where it shows any.

**Look at the PNG yourself before posting it**, to catch a blank or clipped
render (a canvas screenshotted before Phaser drew its first frame is black).

## Step 2: commit the image

`docs/mockups/<YYYY-MM-DD>-<name>.png`, on the **work branch** (never straight
to `main`), staged by its explicit path. The repo is the image host, since
GitHub has no upload API for issue attachments.

## Step 3: embed with exactly this URL form

```markdown
![mockup](https://github.com/starquake/voidmarch/raw/<branch>/docs/mockups/<file>.png)
```

This repo is public, so `raw.githubusercontent.com` would also render. Use the
`github.com/…/raw/…` form anyway: it is the one that keeps working if the repo
is ever made private, and `github.com/…/blob/…` is a click-through link rather
than an embed.

Put it in the ticket's *Mockup* section. If you post it in a comment instead,
the comment opens with the 🤖 attribution line.

**The embed must end up pointing at `main`.** A `/raw/<branch>/` embed dies
when the branch is deleted on merge, silently and retroactively. The PR that
merges the image repoints the embed to `/raw/main/…` (`build-slice`, Finish).
Not a commit SHA: PRs are squash-merged, so the branch's commits aren't in
`main`'s history.

## Step 4: STOP for approval

Move the card to `Your sign-off` and post a Next-steps comment asking for a
yes, or for changes via an answer block. No real UI code before that. To
iterate, re-render to the same filename on the same branch: the embed then
shows the new version.
