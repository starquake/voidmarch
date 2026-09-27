---
name: Spec (spec + plan)
about: A feature or change that is designed in this issue before it is built
labels: 'needs: spec'
---

<!-- The workflow (CLAUDE.md, "How work lands"): fill the SPEC, settle its
     decisions with the maintainer here, then fill the PLAN. The maintainer's
     OK on the plan (dragging the card to Build, or a `go` comment) is the
     go-ahead to build. The implementation PR says `Closes #NN`.

     THIS BODY IS THE LIVING SPEC. THE COMMENTS ARE THE HISTORY.
       - BODY: always current. When a question is answered, MOVE it into
         Decisions and DELETE it from Open questions. The body must never keep
         asking something that has been settled.
       - COMMENTS: append-only. A new `> 🤖 **Next steps**` comment each time
         the state changes; never edit an old one. Answers given in chat are
         written back into this BODY.

     Filed by Claude? The body's first line is the attribution header:
     > 🤖 **Issue by Claude** (AI pair-programmer working with @starquake) — posted through @starquake's account.
     `gh issue create --body-file` bypasses this template, so read it and fill
     its sections by hand. -->

## Spec

### Goal

<!-- One paragraph: what ships, and the one-line reason it exists. -->

### Decisions

<!-- Numbered, settled with the maintainer, each with its why. -->

### Open questions

<!-- Anything still FOR the maintainer, with the options and a
     recommendation on every line. End with a block they copy, fill in and
     paste back as a comment:

     ```
     # keep your pick, delete the rest
     Q1 <topic>: option a (rec) / option b / option c
     Q2 <topic>: option a / option b (rec)
     notes =
     ```

     No view on one? Say so on its line: `discuss (rec)`. Mirror the block in
     the Next-steps comment. Delete this section once everything is settled. -->

### Design

<!-- The Go server (`internal/...`, `cmd/voidmarch`), the TypeScript + Phaser
     client (`frontend/`), what passes between them, the tests (Go, TypeScript,
     `test/integration/`, `frontend/e2e/`) or CI, at whatever depth the change
     needs. Name real Go and TS symbols (files, packages, types, functions,
     classes), since the plan builds on them. Anything that changes the game's
     design says what moves in `docs/design.md`. -->

### Mockup (visual work only)

<!-- Anything whose value is how it LOOKS gets a mockup approved here before
     the real UI is built (the `mockup` skill): a real screenshot of the
     running game (Playwright, or the built-in browser pane on `make server`),
     or a sketch only for UI that doesn't exist yet.
     Embed it with this form:
     ![mockup](https://github.com/starquake/voidmarch/raw/<branch>/docs/mockups/<file>.png)
     The PR that merges it repoints the embed to /raw/main/. -->

### Art constraint

<!-- Which Foozle "Void" pack sprites this uses (pack and file), and any
     recolor or tint. Only mechanics and items that exist in those packs are
     allowed; recolor and tint are the only changes. Anything the packs don't
     have is an open question above, never a sprite drawn or sourced
     elsewhere. New assets are committed PNGs under
     `internal/web/static/assets/`. -->

### Out of scope

<!-- Deferred pieces, each with the issue that tracks it. -->

## Plan

<!-- Tasks in landing order; each ends green (`make check`, plus
     `make test-e2e` for anything touching the client) and is one commit on
     the implementation PR. Failing tests first where practical. Ticked as
     they land: the ticks and the branch are the progress record. -->

- [ ] Task 1 —
- [ ] Task 2 —
- [ ] Docs: `README.md` / `CLAUDE.md` / `docs/design.md` updated in the same PR if anything they say changed
