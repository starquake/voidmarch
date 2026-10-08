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

### A new season

A season ends when the Nautolan Dreadnought falls, after a weekend or a single
day, as the host likes. To start the next one, stop the server and reset its
database: the frontier, the bosses, the hangar, and everyone's parts, loadouts
and stats. Players keep their names.

```bash
docker run --rm -v voidmarch-data:/data ghcr.io/starquake/voidmarch:edge -new-season
```

From a checkout, `go run ./cmd/voidmarch -new-season` resets the file at
`DB_PATH`. Start the server again afterwards.

## Controls

| Input | Action |
|---|---|
| W / A / S / D | Move up / left / down / right on the screen |
| Mouse | Aim |
| Left button (hold) | Fire |
| G | Draw a companion from the hangar (at the home planet) |
| 1 / 2 / 3 | Tap to switch the weapon / engine / shield to the next part you own, anywhere. The slot's list shows for 2 s after the last tap; Esc closes it. A new weapon fires after a half-second swap |
| Click a part slot | Bottom left: a list of that slot's parts above it; click one to fit it, Esc or a click elsewhere closes it |
| M | Full map: click an uncleared sector to send your squadron there; M or Esc closes it |
| Tab (hold) | The season so far: the top players by kills, and you, while held |
| C (when down) | The squadron screen, to move to another squadron or start one; C or Esc closes it and keeps you where you are |
| O | Victory screen, once the season is won: everyone's kills, hit rate, deaths, rescues and sectors; O or Esc closes it |
| Q (hold) | Order ring: point at an order and let go |
| Q (tap) | Repeat the last order |
| Esc | Settings, when no other screen is open; Esc closes it |
| F1 | The intro screen: what the game is, the controls, the sectors and the link to share; F1 or Esc closes it |

The settings screen holds the options: sound, music, controls (screen- or
ship-relative, where W flies toward the mouse), rotation (free or 16
directions), effects, a 60 fps frame rate cap and a lower render resolution
(CSS pixels), the last two for slower graphics. Pick a row with the arrow keys
and change it with Enter, Space, left or right, or click it. The ship holds
still while it's open, and every choice is remembered in the browser. Sound starts after the first click or key press.
The music follows the ship: one looping track in the home sector, one for each
ring (outside the map plays the third ring's), and one while the victory
screen is open, with a crossfade between them.

The HUD shows your ship bottom left: the three fitted parts as their icons,
in their tier's color, and the hull and shield as pips. Top left, a panel
names your squadron and its orders, the hangar at home, how many of your
companions are out, the sector you're in, your mission and any alert. Notices, and the connection while it isn't
online, show as toasts at the top. Bottom right, a hint names F1 for the intro screen and Esc for the settings. On a
development server or offline, **F3** shows frames per second, with the
worst frame of the last second.

### On a tablet or phone

On an iPad, an Android tablet or a phone (a touch screen with no mouse) the
game shows twin-stick touch controls instead, smaller on a phone; `?touch=1`
turns them on anywhere, and `?touch=0` off. Play in landscape.

| Touch | Action |
|---|---|
| Left half | A stick where your thumb lands: move that way on the screen, as far as you push |
| Right half | A stick where your thumb lands: aim that way and fire while pushed; let go to stop (the big space gun fires on release) |
| Summon | Draw a companion from the hangar |
| Orders (hold) | Order ring: slide to an order and let go; a tap repeats the last order |
| Part slots | Bottom left: tap one for its list of parts, and tap a part to fit it |
| Minimap | Full map: tap a sector to send your squadron there, tap beside it to close |
| Respawn buttons | When down, respawn at home or beside a squadmate |
| Squadron button | When down, beside the respawn buttons: the squadron screen |
| Settings | Top left: the settings screen; tap a row to change it, tap beside it to close |
| Help | Beside Settings: the intro screen, with these controls; tap beside it to close |
| Full screen | Beside Help: switch to fullscreen and back (asked for on the first tap too; not on an iPhone, whose Safari can't) |

An iPhone's Safari can't switch a page to fullscreen. Add the game to the
Home Screen instead (Share, then Add to Home Screen): opened from there it
runs fullscreen in landscape.

Two switches in the address help on a phone or tablet without a keyboard:
`?effects=0` turns the bloom and vignette off for that visit, and `?diag=1`
shows the WebGL renderer's limits and any errors in the HUD.

On a development server and offline, debug keys **1**, **2** and **3** cycle
the weapon, engine and shield, locked parts too.

## Playing together

Everyone connected to the same server plays in the same world. On the first
visit you pick a name; your browser remembers it. An intro screen follows, once
per browser: what the game is, its controls, the sectors, and the game's link
with a Copy link button (and Share on a phone or tablet) to send to friends.
**F1**, or **Help** on touch, brings it back. Other players show up with
their name under their ship, in their own colour. Up to 16 players fit; the
17th sees "the frontier is full, try again soon". Without a connection the
game keeps running on its own and reconnects when it can.

## Companions

Press **G** at the home planet to draw a companion from the hangar, up to
three: AI wingmates that fly in formation with you, in your colour, and dodge
enemy fire as they fight. The hangar
is shared by everyone on the server; the HUD shows its ships while you're at
the home planet. A companion sent home, or one whose player leaves, docks back
into it. A new server starts with `POOL_START` ships in it (3 unless set), and
keeps the count across restarts. A derelict ship waits beside every Frigate,
held while any enemy is within 600 px of it: destroy the Frigate and its
escort, then hover beside it for 5 s, or let a companion do it, to rescue it
into the hangar before it drifts off 2 minutes after it was freed. The fleet tops out at 16
ships; past that a rescue still counts, but no ship joins. Hold **Q**
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

You move to another squadron while you're down: **C** (or the Squadron button
on touch) opens the squadron screen again. It lists your own squadron too,
whose Stay keeps you there, as Esc does, and it closes if you're revived. A
move takes over a companion in a squadron at 4 ships, as joining does, and
your companions come along as far as there's room; the rest go home, the
downed ones first. A squadron that empties is gone, and a toast says where
you moved.

## Enemies

The world is 37 hexagonal sectors, home in D4 and three rings around it. Only
home and ring 1 are open at first: a red force field marks where the closed rings
begin, and it zaps and pushes you back. The HUD names the sector you're in. Every other sector is held by a
garrison of its ring's faction: the Kla'ed in ring 1, the Nairan in ring 2 and
the Nautolan in ring 3. The later factions take more hits and fire faster,
quicker shots, and each ring tints the background its own color. Every
garrison has a few Bombers, which fire pairs of slow shots that curve in to
where you were, and Torpedo Ships, which line up and fire one slow Torpedo
that takes two hull steps; there are more of them farther out. In every
ring, Support Ships stay behind their pack and repair it, a thin green line
showing which ship; they have no guns and few hit points. The Nairan
lead their shots and spread out around you; the Nautolan also dodge your shots
and go for whoever is most damaged. A garrison is
8 ships next to home, more farther out, and more again for every
ship that comes in. Its ships roam the whole sector and come for anyone in
it, and destroying all
of it clears the sector for good. Its losses stay, so you can wear it down
over several visits. Every cleared sector adds a ship to the hangar and gives
everyone online a part. Your squadron has a mission, the nearest uncleared
sector: the HUD names it, and a gold arrow at the screen's edge points the
way. The minimap in the top right shows every sector's state, the Frigates,
each squadron's mission and your squadmates; **M** opens the full map, where
a click sends your squadron to another sector. Every few minutes a world
event calls everyone somewhere. It might be an
attack on a cleared sector, to beat within 10 minutes or lose the sector, or a
derelict's distress call: destroy its guard, then rescue it within the 10
minutes. A red arrow points to it. While nobody is online,
the enemy takes a sector back every 4 hours. Scouts, fast and erratic, go down in two hits;
Fighters strafe around you and take six. Their weapons animate just before they fire at anyone within range, and
they leave once nobody is near. Your shield takes hits from the side it
covers while it has charges, and recharges after a few seconds without one,
faster with a squadmate close by. Other hits cost the hull a step, which
heals slowly out of combat. The HUD shows both. Ships and enemies bump
apart. A fast collision with an enemy is a ram that hurts both sides;
friendly ships only push each other. Three hull hits
and you're down: you drift until a friend hovers beside you to revive you,
or after 3 s you respawn with **H** at home or **J** beside a squadmate.
**H** also brings your downed companions home to the hangar, ready for **G**,
except one with a squadmate up within 800 px, which waits there to be
revived. A downed companion nobody revives goes home after 60 s.
While down, **C** switches squadron, and you stay down.
Enemies need the server, so
offline the sandbox stays empty.

A Kla'ed Frigate with three Fighters patrols three of the six sectors around
home (D3, E4 and C4), holding still once you're in range, and a boss sector
is cleared only once its Frigate is down too. It fires slow
rings of big bullets behind a shield bubble that recharges when left alone,
and it's tougher for every player online, a companion counting half.
Its health bar shows at the top while you're close. If everyone near it goes
down it heals, and once destroyed it always drops a part. It's back five
minutes later, unless its sector has been cleared. Further out, four Nairan
Frigates patrol ring 2 and six Nautolan ones ring 3, once those rings are open,
with a Bomber among their escorts and bigger rings of their own faction's shots.

Once four of the six sectors around home are cleared, the Kla'ed Dreadnought
wakes in one of the ring-2 sectors, which opens for it. It guards that sector
alone: the sector's garrison stays away while it's awake. Its health is 1,100
plus 2,900 for every player online, about 10 minutes' fighting alone and 7.5 for
twelve at a good player's pace; the share left is kept between sessions and
regenerates 1% an hour. It fires rings of big bullets, sweeping Ray beams and
spreads of Waves from behind its shield. Destroying it opens ring 2, clears its
sector, gives every player near it a part, and leaves 3 derelicts by the wreck.

Before then it raids ring 1: once a sector there is cleared, every 10 to 15
minutes it teleports into the hostile sector someone is in, out of sight, after
a banner and a warning sound. Drive it off and it leaves a part for everyone
near; otherwise it teleports away after two minutes, or once everyone near it
is down. The damage stays on it for the real fight. The Nairan Dreadnought
raids ring 2 the same way.

Once four of ring 2's sectors are cleared, the Nairan Dreadnought wakes in
ring 3 the same way, with its own health kept between sessions. It fires Ray
sweeps, spreads of Rockets and fans of Torpedoes, and its fall opens ring 3.
If a ring later falls back below four cleared sectors, every ring beyond it
closes again until its Dreadnought is beaten anew.

The Nautolan Dreadnought is the season's finale. It wakes in ring 3 once four
of ring 3's sectors are cleared, and fires Ray sweeps, spreads of Waves and
rings of Spinning Bullets. Each faction's Dreadnought fires as often as its
ships do: the Nairan one half again as often as the Kla'ed, the Nautolan one
twice as often. Its fall wins the season, and it doesn't wake again until a
new one starts. Everyone online sees the victory screen with how long the
season took and each player's stats, and anyone joining later sees it once;
the world stays open behind it.

The season so far shows on the squadron screen when you join, and above the
"You're down" panel while you're down or hold Tab: the top five by kills, and you, with
hit rate and kills per death. When your squadron clears its mission, the
banner names who made the most kills, who aimed best, and who went down.

## Parts

Shot-down enemies drop parts: the Scout sometimes, the Fighter more often,
more often still near a player who's behind their squadron. Fly over one to
collect it for your whole squadron, wherever they are. A part you don't have
is yours for good; one you have goes up a tier, Super, Mega, then Hyper,
each about 15% stronger, shown in blue, violet and gold. A pickup glows in the
tier it would give you, blinks after 20 s and is gone at 30 s. Switch parts
anywhere, in a fight too. Tap **1**, **2** or **3** to switch the weapon,
engine or shield to the next part you own. The slot's list of parts shows
for 2 s after the last tap. You can also click a slot in the gauge for its
list.
A newly fitted weapon fires after a half-second swap. The server remembers
what you fitted.

Add `?wire=json` to the address to see the game's messages as readable JSON in
the browser's network panel.

## Versions

Releases are numbered `vBIG.SMALL.FIX`, and a bigger number is always newer.
The numbers say how big a change is, not what stays compatible: this is not
Semantic Versioning. Everything merged since the last release decides which
number goes up, and the biggest kind wins:

- **BIG** (`v2.0.0`): a milestone-sized change, like mining and escorts or a
  new ring, or anything that resets the world or forces a new season.
- **SMALL** (`v1.1.0`): at least one new thing a player can see or use, such
  as a weapon, an enemy, a HUD change or a control. A big rebalance counts too.
- **FIX** (`v1.0.1`): only fixes, tuning, docs and dependency updates.

The tickets for a release are planned in a GitHub milestone named after its
version.

Each environment is one step more stable than the one before:

- **development** runs `main`: every merge deploys it. A pull request labeled
  `deploy:dev` can take its place until the next merge.
- **staging** runs a release candidate, tagged before the release:
  `v1.0.0-rc.1`, then `v1.0.0-rc.2` if something needs fixing. It stays there
  until the next one. A release candidate gets only its own image tag
  (`1.0.0-rc.1`, never `1.0` or `latest`), and its GitHub release is marked as
  a pre-release.
- **production** runs the release. Once the last release candidate is good,
  its commit is tagged as the release (`v1.0.0`).

## Configuration

| Variable  | Default      | Meaning |
|-----------|--------------|---------|
| `APP_ENV` | `production` | `development` or `production`. |
| `HOST`    | (all)        | Address to listen on. |
| `PORT`    | `8080`       | Port to listen on. |
| `WEB_DIR` | (embedded)   | Serve the client from this directory instead of the embedded copy, never cached for good, so edits show on a reload. Development only. |
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

The libraries the server and the client are built from, with their licences,
are in [THIRD-PARTY.md](THIRD-PARTY.md), which the Docker image carries too.


- Art: the Void asset packs by [Foozle](https://foozlecc.itch.io/), CC0.
- Music: [5 Chiptunes (Action)](https://opengameart.org/content/5-chiptunes-action) by Juhani Junkala, CC0.
- Sound effects: [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) by Kenney, CC0.
- Fonts: [Orbitron](https://github.com/theleagueof/orbitron) by The League of Moveable Type and [Exo 2](https://github.com/googlefonts/Exo-2.0) by Natanael Gama, both SIL Open Font License 1.1 (`internal/web/static/fonts/*-OFL.txt`).

## License

MIT, see [LICENSE](LICENSE).
