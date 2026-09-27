# Voidmarch

[![CI](https://github.com/starquake/voidmarch/actions/workflows/ci.yml/badge.svg)](https://github.com/starquake/voidmarch/actions/workflows/ci.yml)
![coverage](https://raw.githubusercontent.com/starquake/voidmarch/badges/.badges/main/coverage.svg)

A co-op twin-stick space shooter for a group of friends, played in the
browser. The world is persistent: players drop in and out, and together push
the frontier outward by defeating each alien faction's Dreadnought.

The game is in early development. The design is in [docs/design.md](docs/design.md);
the work is tracked on the [project board](https://github.com/users/starquake/projects/6).

## Run it

With Docker:

```bash
docker run -p 8080:8080 ghcr.io/starquake/voidmarch:edge
```

Then open http://localhost:8080.

From a checkout (needs Go and Node.js 24):

```bash
make server
```

## Controls

| Input | Action |
|---|---|
| W A S D | Move |
| Mouse | Aim |
| Left button (hold) | Fire |

The sandbox has debug keys until loadouts arrive: **1**, **2** and **3** cycle
the weapon, engine and shield; **H** cycles the hull damage state; **R**
switches between free rotation and 16 directions; **F** turns effects on and
off.

## Configuration

| Variable  | Default      | Meaning |
|-----------|--------------|---------|
| `APP_ENV` | `production` | `development` or `production`. |
| `HOST`    | (all)        | Address to listen on. |
| `PORT`    | `8080`       | Port to listen on. |
| `WEB_DIR` | (embedded)   | Serve the client from this directory instead of the embedded copy. Development only. |

## Development

`make help` lists every target. The ones used most:

| Target | What it does |
|---|---|
| `make check` | Lint, type-check, unit and integration tests with coverage, bundle drift check. Run before every PR. |
| `make test-e2e` | Browser tests in Chromium and Firefox (`make e2e-install` first). |
| `make js-watch` + `make server-dev` | Rebundle the client on change and serve it from disk. |
| `make docker` | Build the image as `voidmarch:dev`. |

The server is Go (`cmd/`, `internal/`). The client is TypeScript and Phaser in
`frontend/`, bundled with esbuild into `internal/web/static/js`; the bundle is
committed so `go build` needs no Node.js.

## Credits

Art: the Void asset packs by [Foozle](https://foozlecc.itch.io/), CC0.

## License

MIT, see [LICENSE](LICENSE).
