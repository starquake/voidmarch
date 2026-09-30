# Voidmarch

A drop-in/drop-out, persistent-world, co-op twin-stick space shooter for 1–16
friends, played in the browser. `docs/design.md` is the design: its vision,
mechanics, architecture and milestones. The milestones are the issues on the
board.

- **Server**: Go, stdlib first, in `cmd/voidmarch` and `internal/`. It is the
  authority for the shared world and serves the client embedded from
  `internal/web/static`.
- **Client**: TypeScript and Phaser 4 in `frontend/src`, bundled with esbuild
  into `internal/web/static/js`. The bundle is committed, so `go build` and
  the Docker image need no Node.js. Phaser is a separate vendor module
  (`js/vendor/phaser.js`), and the game bundle imports it as `./vendor/phaser.js`.
- **Game rules live once, in Go** (`internal/sim`, #13 decision 26): plain
  functions and data, unit-tested in Go. The server imports it natively. The
  browser runs its part (its own ship and the projectiles) as WebAssembly:
  `cmd/simwasm` exports `internal/simbridge`, TinyGo builds it into the
  committed `internal/web/static/wasm/sim.wasm` (`make wasm`), and
  `frontend/src/simwasm.ts` mirrors its state for the scenes. The id lists,
  tunables and state layout the TypeScript needs are generated into
  `frontend/src/sim/rules.gen.ts` (`make simgen`, part of `make wasm`).
  `frontend/src/sim/` keeps only what isn't a rule: input mapping, zoom,
  asteroid decor and presentation tunables. The Phaser scenes only read
  input, step the sim and draw it.
- **The way out of TinyGo** is standard Go WebAssembly: the same package
  builds with `GOOS=js GOARCH=wasm` and no code changes, only a bigger
  download. `make test-wasm-fallback` proves it on every check.
  `make test-tinygo` runs the Go sim's own tests compiled by TinyGo.
  `internal/sim/testdata/golden.json` holds the old TypeScript sim's recorded
  results, as regression cases.

## Hard rules

- **Art: only what exists in Foozle's Void packs** (CC0,
  https://foozlecc.itch.io/). Mechanics and items need a sprite in those packs;
  recoloring and tinting are allowed. The PNGs live in
  `internal/web/static/assets/`, with their license in `LICENSE.md` there.
  Things intentionally absent: currency, stations, outposts, base building, a
  player ship explosion.
- **Players are friends.** The client is trusted for its own movement and hit
  reports; griefing and cheating are not design concerns.
- **No third-party HTTP framework or ORM.** A dependency needs a reason the
  standard library cannot meet (a WebSocket server, an SQLite driver).
- **ASCII only in `.go` sources.** `make lint-ascii` fails on anything else.
- **Never edit the bundle by hand.** `internal/web/static/js/` is build output
  of `make js`; `make js-check` fails when it is stale. The same goes for
  `internal/web/static/wasm/` and `frontend/src/sim/rules.gen.ts` (`make
  wasm`, checked by `make wasm-check`).
- **Never `kill` a process you didn't start.** Ask first.

## Commands

```bash
make check      # lint, ascii, proto lint/drift, ts check/lint/test, bundle drift, build, Go tests + coverage: before every PR
make test       # fast Go tests (integration tests skip under -short)
make test-e2e   # Playwright, chromium + firefox, against the embedded client
make js         # rebuild the committed bundle after any frontend/ change
make wasm       # rebuild the committed WebAssembly sim and rules.gen.ts after any internal/sim change
make test-tinygo # internal/sim's tests compiled by TinyGo, run under Node's WASI
make proto      # regenerate Go and TypeScript after any proto/ change
make sqlc       # regenerate internal/db after any internal/store/queries or migrations change
make lint-fix   # golangci-lint --fix and eslint --fix
make server     # the server with the embedded client on :8080
make js-watch   # with make server-dev: edit, reload, no rebuild
make docker     # the image as voidmarch:dev
```

`golangci-lint`, `buf` and `sqlc` are downloaded to `build/bin/` at the
versions pinned in the Makefile (`GOLANGCI_VERSION`, `BUF_VERSION`,
`SQLC_VERSION`); CI reads the same pins, and `tools/go.mod` requires the same
versions so Dependabot sees new releases. TinyGo and Binaryen (its `wasm-opt`) unpack under
`build/_toolchains/`, which `./...` skips, at `TINYGO_VERSION` and
`BINARYEN_VERSION`; CI caches them. `protoc-gen-go` is built from the version `tools/go.mod` requires, and
`protoc-gen-es` comes from npm. `frontend/go.mod` is a stub module so that
`go ... ./...` skips `frontend/node_modules`.

## Multiplayer

- **The protocol is `proto/voidmarch/v1/messages.proto`**: WebSocket at
  `/ws`, binary protobuf, or protobuf JSON in text frames when the page has
  `?wire=json`. The server answers each connection in the format it receives.
  `WIRE_LOG=true` logs every message, decoded.
- **Generated code is committed and never edited**: `internal/gen/` and
  `frontend/src/gen/` come from `make proto`, and `make proto-check` fails when
  they are stale. A Dependabot bump of `google.golang.org/protobuf` or
  `@bufbuild/*` that fails only on proto drift gets `make proto` committed onto
  its branch, like bundle drift. Change `proto/` in backward-compatible steps
  (new field numbers, never reused).
- **Clients are trusted for their own ships** (design §9). `internal/game`'s
  hub relays: it keeps each player's latest state and stamps shots with its
  tick. The client draws others 2 ticks (100 ms) in the past
  (`frontend/src/net/interpolation.ts`), and their shots on the same delayed
  timeline, so both line up.
- **Enemies are the server's** (`internal/game/enemies.go`): it spawns, steers
  and fires them, and applies the clients' `Hit` reports. Enemy bullets are
  never streamed: `EnemyFired` carries a seed, and `internal/sim/patterns.go`,
  run in the browser as WebAssembly, expands it identically on every client. Hub tests use `WithSeed` and step the
  hub by hand, so enemy behaviour is deterministic.
- **Companion brains are Go sim code** (`internal/sim/brain.go`): `Think`
  turns a companion's view and orders into the same `Command` the keyboard
  makes, pure and seeded, and `sim.Wing` flies a player's companions.
- **Companions are the hub's seats** (`internal/game/companions.go`,
  `flight.go`): the server grants `Summon`, and a companion is then the seat
  `<playerId>/<n>`, flown by the hub at the sim's 60 Hz (three steps per hub
  tick) and sent in snapshots like any ship, its owner's included. The hub
  fires its shots as `RemoteShot`, tests them against its enemies and gives
  `SquadronOrder` to every companion in the squadron. Clients never report a
  companion's state, shot or hit (#51). Seats count toward
  `MaxPlayers`. Development and E2E keep the production limits (3 each, at the
  home planet, 4 ships per squadron). Summons draw from the shared hangar,
  `POOL_START` ships on a fresh database (3 by default); the E2E server sets 15,
  since the specs share it, and hub tests without `WithPoolStart` get a ship
  per seat. The hub saves the fleet through `WithSaveFleet`.
- **Persistence** (`internal/store`, #76): a SQLite file at `DB_PATH` through
  `modernc.org/sqlite`, pure Go so the build stays cgo-free. Migrations are
  embedded `internal/store/migrations/NNN_*.sql`, applied in order and
  tracked by `PRAGMA user_version`; add a new file, never edit an applied
  one. Queries are SQL in `internal/store/queries/*.sql`; sqlc generates the
  typed Go in `internal/db` (committed, never edited; `make sqlc-check` fails
  when it is stale). It keeps players (`players.Store`, tokens as SHA-256
  hashes) and the fleet. Tests open a real temporary database with `testutil.OpenDB`;
  `startServer` and the E2E server each get their own file, and E2E sets
  `REGISTER_LIMIT=0`.
- **Squadrons** (`internal/game/squadrons.go`): everyone picks one with
  `ChooseSquadron` (empty starts a new one, Greek-named); the server sends
  `Squadrons` on every change and caps them at 4 ships. `SquadronOrder` is
  relayed to squadmates as `SquadronOrdered`, and every client applies it to its
  own companions. The join screen (`frontend/src/squadrons.ts`) only shows when
  there's a squadron with room; E2E's first page per spec starts its own.
- **A hidden tab keeps playing** (#57): browsers stop a hidden tab's
  animation frames, so a worker (`frontend/src/background.ts`) steps the sim
  and sends the ship's state instead, drawing nothing. The hub drops a player
  only after 10 s of silence (`silenceTicks`).
- **E2E runs everyone on one server**: each test's page is a registered player
  (`frontend/e2e/fixtures.ts`), so specs see each other's ships and shots.
  Assert on your own state (`shotsFired`, `ship`), never on shared counts.

## How work lands

**The ticket is canonical.** Every conversation about a piece of work happens
in its GitHub issue. Chat is optional and the maintainer may not read it: an
answer given in chat is written back into the issue body before acting on it.

- **Claude reviews its own diff before handing a PR over**: the whole branch
  against `main`, for what the gates cannot see (leftovers from earlier
  iterations, behaviour against the ticket, input and state edge cases, the
  art rule). Defects are fixed straight away and listed in the PR; judgement
  calls are a review comment on their line, left for the maintainer to answer
  `fix`, `skip` or `ticket` (`build-slice`).
- **Everything lands via a pull request** with an issue behind it, including
  chores and docs. One issue, one deliverable; a ticket that needs several PRs
  in different states is split into sub-issues. A PR says `Closes #NN` only
  when it completes every task in the ticket's plan, maintainer steps included;
  otherwise `Part of #NN`, and the ticket stays open. **A parent issue with a
  sub-issue still open is never closed by a PR**, whatever its own plan says,
  and a sub-issue's ticket or PR never mentions closing its parent: they say
  `Part of #NN` (starquake-recompiled#76 closed its #1 with four sub-issues
  still open, starquake-recompiled#84).
- **Dependabot's pull requests are the one exception**: they have no issue
  behind them and no card (`.github/dependabot.yml`), and they merge
  themselves: `.github/workflows/dependabot-auto-merge.yml` squash-merges each
  once the required checks pass. Claude never merges one by hand and never adds
  `ready to merge` to one. It keeps them mergeable: one left behind `main` is
  rebased locally and force-pushed, and a `frontend/` bump that fails only on
  bundle drift gets the rebuilt bundle committed onto its branch.
- **The gate is `make check`** (lint, the TypeScript check, lint and tests,
  bundle drift, the build, the Go tests with coverage), plus `make test-e2e`
  for anything touching the client, on every commit. The ruleset lives as code
  in `.github/rulesets/main.json`: squash only, signed commits, linear history,
  every review thread resolved, the branch up to date with `main`, and the
  required checks `lint`, `build`, `e2e (chromium)`, `e2e (firefox)` and
  `docker`.
- **Branches and commits**: a branch is `<issue>-<slug>`
  (`1-single-player-sandbox`). A commit is a plain one-line capitalized
  subject with no body and no trailer, signed with the local SSH key, staging
  explicit paths. A branch behind `main` is rebased locally and force-pushed:
  never merge `main` into a branch and never `gh pr update-branch`, since a
  server-side update makes unsigned commits, which the ruleset blocks.
- **The board is the handoff baton**: the Status field of the "Voidmarch"
  user Project (https://github.com/users/starquake/projects/6).
  Read and move it with `.claude/scripts/board.sh`.

  ```
  Backlog · Your input · Spec · Plan · Your sign-off · Build · Your review · Done
  ```

  **If a state says "your", it is the maintainer's gate** and work stops;
  `Spec`, `Plan` and `Build` are Claude's and proceed without re-asking.
  `Your input` (questions) can interrupt any stage. `Your sign-off` comes
  BEFORE a build (approve the spec, plan or mockup); `Your review` comes AFTER
  it (the PR is open, awaiting `ready to merge`). Cards move both ways and
  stages can be skipped: a bug or tweak goes straight to `Build`.

- **Approval** of a spec or plan is the maintainer dragging the card on, or a
  `go` / `approved` comment. Never proceed from plan to build without it.
- **A card dragged to `Spec` means "your call"**: first decide whether it needs
  a spec at all, and say so on the ticket. With no design question left it goes
  on to `Plan`; a bug or tweak needing no plan goes on to `Build`.
- **A card dragged to `Build` is the go**, even when its plan is missing or
  names another project's code: the plan is written into the body before the
  first commit, and built, with no sign-off round (zx-sidekick#27).
- **The `Backlog` column's order is the priority.** Nothing leaves `Backlog`
  without the maintainer; "pick up the next one" means its top card.
- **Merging needs the `ready to merge` label** on the PR, re-read from the API
  at the moment of merging. Claude never adds it and never merges without it.
- **A position in the flow is a Status; a property of a ticket is a label**:
  `ready to merge`, `hold` (skip entirely), `dependencies` (Dependabot's),
  and, **only while a ticket waits in `Backlog`**, its route: `needs: spec` (a
  design question to settle) or `needs: build` (none left), with the routing
  reason in the body. The route says where the card goes when it is picked up.
  **A card in a lane carries no route label**: the lane already says where it
  stands, so the label comes off in the same step as the move out of
  `Backlog` (@starquake, 2026-09-15). A parent carries none either.
- **A ticket ported from a sibling repository goes in the lane its content puts
  it in**: open questions to `Your input`, a settled spec with a plan to
  `Your sign-off` and one without to `Plan`, a parent to `Backlog` with no
  label.
- **The body is the living spec; the comments are append-only history.** When
  a question is answered it moves into _Decisions_ and is deleted from _Open
  questions_. Every state change gets a NEW `> 🤖 **Next steps**` comment;
  never edit an old one.
- **Questions go in a copy-paste answer block**: a fenced block headed
  `# keep your pick, delete the rest`, one line per question, every line
  carrying a `(rec)`, ending with `notes =`. Posting one moves the ticket to
  `Your input` in the same step.
- **Visual work gets a mockup approved before the real UI is built**
  (`mockup` skill): a real screenshot of the running game (Playwright, or the
  built-in browser pane on `make server`), a sketch only for UI that doesn't
  exist yet. Mockups are committed under `docs/mockups/`.
- **Nothing becomes public without asking**: the board, a release or a tag.

### Attribution: issues, comments and PR descriptions yes, commits no

`gh` acts as @starquake, so an unmarked Claude comment reads as the
maintainer's own answer — and the board monitor tells them apart by exactly
that prefix. So **every issue, comment and pull request description Claude
posts** opens with one of these lines, posted via `--body-file`:

- `> 🤖 **Issue by Claude** (AI pair-programmer working with @starquake) — posted through @starquake's account.`
- `> 🤖 **Comment by Claude** (AI pair-programmer working with @starquake) — posted through @starquake's account.`
- `> 🤖 **Pull request by Claude** (AI pair-programmer working with @starquake) — posted through @starquake's account.`

The line on a pull request says what happens: Claude opens it, the maintainer
reviews and merges it, and takes accountability for what is merged
(@starquake, 2026-09-15). **Commit messages carry no attribution line and no
trailer**: the squash-merge commit on `main` is the maintainer's own, signed
by GitHub.

The procedure behind each step lives in the skills: `work-the-board` (and its
`/board` alias), `design-slice`, `mockup`, `build-slice`, `merge-pr`,
`issue-comment-replies`.

## Go

Follow the Google Go Style Guide (https://google.github.io/styleguide/go/)
and the module layout for a server project
(https://go.dev/doc/modules/layout). The shape follows
[topbanana](https://github.com/starquake/topbanana):

- `main` only parses flags and calls `app.Run(ctx, getenv, stdout, ln)` or
  another `app` command, printing the error and exiting 1.
- Configuration comes from the environment through `config.Parse(getenv)`,
  with a sentinel `ErrX` per invalid value. An unset `APP_ENV` means
  production.
- `server.New(deps...) http.Handler` builds the mux via `addRoutes` and wraps
  the middleware. Routes use Go 1.22 patterns (`"GET /static/"`).
- Handlers are constructors, `HandleX(deps...) http.Handler`, returning a
  closure. Request and response types are declared inside them.
- The logger is passed explicitly; the request-scoped one comes from
  `handlers.LoggerFromContext`. Log with `logger.XxxContext(ctx, "lowercase
  msg", slog.Any("err", err))`.
- Always handle errors, never shadow `err`, and wrap every returned error:
  `fmt.Errorf("error doing x: %w", err)`. Log-and-return uses one `msg`.
- Every package, type and function has a doc comment (godoclint), kept to what
  a reader needs.

## TypeScript

- `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`;
  ESLint `strictTypeChecked` and `stylisticTypeChecked`. `make ts-check
  ts-lint` must be clean, no `eslint-disable` without a reason on the line.
- Imports inside `frontend/src` carry the `.ts` extension, so Node runs the
  tests without a build. Only erasable syntax: no enums, no namespaces, no
  parameter properties.
- The rules (`internal/sim`) are pure: no clock, no global randomness (pass
  time and seeds in), so every client computes the same bullets.
- Rule tunables live in `internal/sim/tuning.go`; presentation tunables in
  `frontend/src/sim/tuning.ts`. Neither is scattered as literals.

## Testing

Every change comes with tests. Write a test instead of a one-off check script:
a curl or a scripted browser session verifies once and is thrown away; a test
catches the regression forever. The built-in browser pane and screenshots are
for looking, never for assuring behaviour.

- **Go unit tests**, `foo_test.go` beside `foo.go`, in the external package
  (`package foo_test`, dot-importing `foo`); unexported things go through
  `export_test.go`. `t.Parallel()` everywhere, table tests with `tc`, and
  `httptest.NewRequestWithContext(t.Context(), ...)`. Assertions:

  ```go
  if got, want := err.Error(), "error creating question"; !strings.Contains(got, want) {
  	t.Errorf("err.Error() = %q, should contain %q", got, want)
  }
  ```

- **Integration tests** touch real I/O (a running server, a database, the
  embedded files) and skip under `testing.Short()`. Full-stack tests go
  through `startServer` in `test/integration/`. Use real databases (a temporary
  SQLite file), not mocks; keep a fake only where the real thing cannot
  produce the case.
- **TypeScript unit tests**, `foo.test.ts` beside `foo.ts`, with `node:test`
  and `node:assert/strict`. The coverage gate (80% lines, branches and
  functions) covers `src/sim/`, `src/net/` and `src/simwasm.ts`, whose tests
  drive the committed WebAssembly module in Node.
- **E2E**, `frontend/e2e/*.spec.ts`, for what only a browser shows: the
  client boots with no console errors or failed requests, input moves the
  ship. The page publishes read-only state on `window.voidmarch` for the specs
  to inspect.
- **Coverage**: CI fails the Go total below 80% (`threshold-total` in
  `ci.yml`, which overrides `.testcoverage.yml`). Aim well above it.
- **A flaky test is a bug to file**, not to rerun past.

## CI required checks

`main` is protected by the ruleset in `.github/rulesets/main.json`, which is
the source of truth. Its required checks are the jobs of `ci.yml`: `lint`,
`build`, `e2e (chromium)`, `e2e (firefox)` and `docker`. When you add, rename
or remove a job, change the ruleset file in the same PR and apply it:

```bash
RID=$(gh api repos/starquake/voidmarch/rulesets --jq '.[] | select(.name=="main").id')
gh api -X PUT repos/starquake/voidmarch/rulesets/$RID --input .github/rulesets/main.json
```

A required context that no job produces blocks every PR.

## Comments

Default to none. Well-named identifiers and small functions say *what*; a
comment earns its place only for a non-obvious *why*: a hidden constraint, an
invariant, a workaround. Keep it to one short line. Don't restate the code and
don't reference the current task or caller (`// added for #12`); issue links
that carry the reason are fine (`// see #12`). A why that describes what
another part of the system expects rots silently: rewrite it as a local
reason, or point at the test that pins it (`// invariant pinned by TestX`).

## Writing

**Code uses US spelling** (color, behavior, center, gray, traveled):
identifiers, comments, log messages, UI strings and proto fields
(@starquake, 2026-09-28, #43). Docs prose is free.

Release notes, README, UI strings, commit messages and PR descriptions are
plain and factual: say what is there, with neutral verbs, and no selling.
