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
docker run -p 8080:8080 -v voidmarch-data:/data ghcr.io/starquake/voidmarch:edge
```

Then open http://localhost:8080. Players and the hangar are kept in a SQLite
file, `/data/voidmarch.db` in the image, so the volume keeps them across
restarts and upgrades.

From a checkout (needs Go and Node.js 24):

```bash
make server
```

## Controls

| Input | Action |
|---|---|
| W / S | Thrust toward / away from the mouse |
| A / D | Strafe left / right |
| Mouse | Aim |
| Left button (hold) | Fire |
| G | Draw a companion from the hangar (at the home planet) |
| L | Loadout screen: fit your parts (at the home planet); Esc closes it |
| Q (hold) | Order ring: point at an order and let go |
| Q (tap) | Repeat the last order |
| C | Switch to screen-relative movement (W is up the screen) and back |
| M | Sound on/off |
| N | Music on/off |

The movement, sound and music choices are remembered in the browser. Sound
starts after the first click or key press.

On a development server and offline, debug keys **1**, **2** and **3** cycle
the weapon, engine and shield, locked parts too; **R** switches between free
rotation and 16 directions; **F** turns effects on and off.

## Playing together

Everyone connected to the same server plays in the same world. On the first
visit you pick a name; your browser remembers it. Other players show up with
their name under their ship, in their own colour. Up to 16 players fit; the
17th sees "the frontier is full, try again soon". Without a connection the
game keeps running on its own and reconnects when it can.

## Companions

Press **G** at the home planet to draw a companion from the hangar, up to
three: AI wingmates that fly in formation with you, in your colour. The hangar
is shared by everyone on the server; the HUD shows its ships while you're at
the home planet. A companion sent home, or one whose player leaves, docks back
into it. A new server starts with `POOL_START` ships in it (3 unless set), and
keeps the count across restarts. A destroyed Frigate leaves a derelict ship
behind: hover beside it for 5 s, or let a companion do it, to rescue it into
the hangar before it drifts off after 2 minutes. The fleet tops out at 16
ships. Hold **Q**
for a ring of orders, point at one and let go; tap Q to repeat the last. Every
order goes to your whole squadron. There are five modes, Escort, Attack, Guard,
Hold here and Stealth, and three one-shots that return to the mode when done:
Focus (the enemy under the cursor, or else the one you last hit), Regroup and
Go home.

Other players see your companions as ships of yours. Companions count toward
the 16 seats, so a player joining a full world sends the newest companion
home.

## Squadrons

Everyone flies in a squadron of up to 4 ships, companions included. Joining a
server with squadrons that have room, you pick one or start your own (Alpha,
Beta, Gamma…); alone, you just start one. Joining a squadron that is at 4
ships takes over one of its companions. Orders are the squadron's: your
squadmates see "you: Attack", and every companion in the squadron follows.

## Enemies

The home planet is safe. Fly away from it and the Kla'ed come for you: Scouts,
fast and erratic, go down in two hits; Fighters strafe around you and take
six. Their weapons animate just before they fire at anyone within range, and
they leave once nobody is near. Your shield takes hits from the side it
covers while it has charges, and recharges after a few seconds without one,
faster with a squadmate close by. Other hits cost the hull a step, which
heals slowly out of combat. The HUD shows both. Ships and enemies bump
apart, and a fast collision is a ram that hurts both sides. Three hull hits
and you're down: you drift until a friend hovers beside you to revive you,
or after 3 s you respawn with **H** at home or **J** beside a squadmate.
Enemies need the server, so
offline the sandbox stays empty.

Far to the north waits a Kla'ed Frigate with three Fighters. It fires slow
rings of big bullets behind a shield bubble that recharges when left alone,
and it's tougher for every player who comes near, a companion counting half.
Its health bar shows at the top while you're close. If everyone near it goes
down it heals, and once destroyed it always drops a part and is back five
minutes later.

## Parts

Shot-down enemies drop parts: the Scout sometimes, the Fighter more often,
more often still near a player who's behind their squadron. Fly over one to
collect it for your whole squadron, wherever they are. A part you don't have
is yours for good; one you have goes up a tier, Super, Mega, then Hyper,
each about 15% stronger, shown in blue, violet and gold. A pickup glows in the
tier it would give you, blinks after 20 s and is gone at 30 s. Press **L** at
the home planet to fit your parts; the server remembers what you fitted.

Add `?wire=json` to the address to see the game's messages as readable JSON in
the browser's network panel.

## Configuration

| Variable  | Default      | Meaning |
|-----------|--------------|---------|
| `APP_ENV` | `production` | `development` or `production`. |
| `HOST`    | (all)        | Address to listen on. |
| `PORT`    | `8080`       | Port to listen on. |
| `WEB_DIR` | (embedded)   | Serve the client from this directory instead of the embedded copy. Development only. |
| `WIRE_LOG` | `false`     | Log every WebSocket message, decoded. For debugging. |
| `DB_PATH` | `voidmarch.db` (`/data/voidmarch.db` in the image) | The SQLite file that keeps players and the hangar. Its directory must exist. |
| `POOL_START` | `3`       | Companion ships in the hangar on a fresh database; after that the saved count is used. |
| `REGISTER_LIMIT` | `20`  | New names one address may register a minute, enough for a full server of friends on one network; `0` lifts the limit. A name never used to play is deleted after a day. |
| `MAP` | `frontier` | The game map: where the bosses sit. `e2e` puts the Frigate near home for the browser tests. |
| `TRUSTED_PROXY_IPS` | (none) | Comma-separated CIDRs of reverse proxies in front of the server, such as `10.0.0.0/8`. The limit then counts the address in their `X-Forwarded-For`, not the proxy's. |

## Development

`make help` lists every target. The ones used most:

| Target | What it does |
|---|---|
| `make check` | Lint, type-check, unit and integration tests with coverage, bundle drift check. Run before every PR. |
| `make test-e2e` | Browser tests in Chromium and Firefox (`make e2e-install` first). |
| `make js-watch` + `make server-dev` | Rebundle the client on change and serve it from disk. |
| `make docker` | Build the image as `voidmarch:dev`. |

The server is Go (`cmd/`, `internal/`). The client is TypeScript and Phaser in
`frontend/`, bundled with esbuild into `internal/web/static/js`. The game's
rules are Go (`internal/sim`): the server runs them natively, and the browser
runs its part as WebAssembly, built by TinyGo into `internal/web/static/wasm`
(`make wasm`, which downloads the pinned TinyGo). The bundle and the module
are committed, so `go build` needs neither Node.js nor TinyGo.

## Credits

- Art: the Void asset packs by [Foozle](https://foozlecc.itch.io/), CC0.
- Music: [Explorer Chiptune Music](https://foozlecc.itch.io/explorer-chiptune-music) by Foozle, CC0.
- Sound effects: [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) by Kenney, CC0.

## License

MIT, see [LICENSE](LICENSE).
