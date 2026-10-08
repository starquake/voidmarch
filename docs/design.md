# Voidmarch — Game Design Document

> A drop-in/drop-out, persistent-world, co-op twin-stick space shooter for a group of friends (1–16 players), playable in the browser with no install.
>
> *About the name: a "march" is an old word for a borderland, literally a frontier. Voidmarch is the frontier of the void, pushed outward together.*

## 1. Vision

**The main idea: conquering sectors together, over a weekend of drop-in play** (#90). The server runs all weekend on the side. Friends drop in, clear sectors of the frontier together, leave, and come back to win back what the enemy retook while they were away. Every evening shows on the map: ground gained, and sometimes ground lost. Later, more ways to conquer a sector join clearing its garrison (#90, "Later").

- **Web only, no install.** Open a URL, pick a name, play.
- **Drop in / drop out.** The world is persistent and keeps existing when nobody is online. Some evenings 1 player is on, sometimes 3, on a busy evening 16.
- **Nobody feels behind.** Progress is mostly *shared* (the frontier). Personal progress is mostly *horizontal* (more options), with a modest, capped step up through part tiers (§4).
- **Shared goal:** clear the frontier sector by sector, ring by ring, defeating each faction's Dreadnought to open the next ring. Defeat all three and the season ends.
- **Personal goals:** collect all 12 ship parts and experiment with loadouts.
- **Players are friends.** Griefing and cheating are not design concerns. This lets us trust the client (see §9).

## 2. Hard constraint: art

**Only use mechanics and items that exist in Foozle's "Void" asset packs** (CC0, <https://foozlecc.itch.io/>). Recoloring and tinting existing sprites **is allowed**.

| Pack | Contents | Use |
|---|---|---|
| Void – Main Ship | Player ship base sprite in 4 damage states, 4 engines, 4 shields, 4 weapons (with projectiles), all animated | Player ships |
| Void – Pickups Pack | 12 animated pickups, one per part: the 4 weapons, 4 engines and 4 shields (checked in #6), each a 15-frame 32 × 32 blink | Part drops, unlocks and tier upgrades |
| Void – Fleet Pack 1 (Kla'ed) | 8 ships: Scout, Fighter, Support Ship, Bomber, Torpedo Ship, Frigate, Battlecruiser, Dreadnought. Animated engines, shields, weapons, destruction. 5 projectiles | Faction 1 enemies |
| Void – Fleet Pack 2 (Nairan) | Same 8 classes, different faction look | Faction 2 enemies |
| Void – Fleet Pack 3 (Nautolan) | Same 8 classes, different faction look | Faction 3 enemies |
| Void – Environment Pack | Layered parallax backgrounds, animated planet, asteroid | World, home planet, asteroids |

Everything is pixel art at native resolution. Render with nearest-neighbor scaling (e.g. 2× or 3×). Aseprite sources are included if re-exporting is needed.

Sound comes from CC0 packs too: Kenney's Sci-Fi Sounds for effects, and Juhani Junkala's 5 Chiptunes (Action) for music. The music follows place, each place looping one track: Title Screen in the home sector, Level 1, 2 and 3 in rings 1, 2 and 3 (outside the map counts as ring 3), and Ending while the victory screen is open. It crossfades over 2 s as the place changes (#187).

**Things intentionally NOT in the game (no art for them):** currency/scrap, space stations, outposts, base building, player ship explosion.

**Future (allowed via reuse/recolor):** asteroid mining (Environment asteroid), escort missions (enemy ships recolored as friendly convoys).

## 3. Controls & feel

- **The HUD** (#91): see-through panels in the page, never taking the pointer, so ships behind them stay visible.
  - **The gauge, bottom left:** the three fitted parts as their Pickups pack icons, each bordered in its tier's color; hull pips (one per hit the ship can still take); shield charges.
  - **The panel, top left,** as far in from the edges as the minimap: labelled rows for the squadron and who's in it, its orders and what they do, the hangar (at home), your companions out of the most you may have (#191), the sector you're in, the mission and a world event's alert.
  - **Toasts at the top:** each notice, fading when it ends; the connection, while it isn't online.
  - **Announcements** (a new mission, a clear, an attack, a raid): a banner in the middle near the top, gold in a see-through box, one at a time for 6 s each. It's a page element on top of everything, the screens, the HUD and the full map included, and it takes no pointer or keyboard input, so it never blocks what's under it (#272).
  - **The keys** are on the intro screen (#193): it shows once on a first visit, after the name screen, and again from F1 or the Help touch button. It has the premise, the device's controls, the sectors, a line each on companions, parts, going down, squadrons and the season, and the game's link to copy or share. Bottom right, a hint reads "F1 help · Esc settings" on a keyboard. On a development server or offline, F3 adds frames per second.
  - **Loading** (#227) starts at once, behind the name screen: the rules, the fonts, the sprite sheets and the sound effects. Once a name is entered, a strip docked at the bottom shows how far it got, by bytes from the game's code onward, and which category is loading (Ships, Enemies, Space or Sounds, never a file's or an enemy's name), under the intro on a first visit or alone for a returning player, until the game is up. Play waits for it. The screens come one at a time: the name, the intro, then the join screen. Music loads later, in the background.
  - The minimap's sectors are see-through too (`MINIMAP_FILL_ALPHA`); the full map keeps its fill, since it covers the screen and the ship holds still under it.

- **Twin-stick:** WASD to move, mouse to aim, hold left mouse button to fire.
- **On a tablet** (#180): floating touch sticks, each where a thumb lands. The left half moves, as far as it's pushed and up the screen as up; the right half aims and fires while pushed past a dead zone, so one thumb aims and shoots and letting go stops. Buttons stand in for Summon, Orders (hold and slide onto the ring), the respawns and switching squadron while down (#45), and Help (#193), and a tap on a part slot opens its list (#191); a tap on the minimap opens the full map. It turns on by itself on a touch screen with no mouse (`pointer: coarse`), with `?touch=1` / `?touch=0` to force it, and hides the HUD's key hint. Some phones' GPUs (a PowerVR D-Series in a recent Pixel) run Phaser's all-in-one blend shader without an error but draw the bloomed world black, so the bloom blends with a small shader of its own (`frontend/src/scenes/blend.ts`), and a check a moment after the start turns the bloom off if the middle of the screen still comes out pure black. A small switch in the top left turns fullscreen on and off, and the first tap asks for it (on the lift: browsers allow fullscreen only from a completed tap). Phones work too (@starquake: "Phone size should work too but things can be smaller for that if needed"): on a screen under 700 CSS pixels tall the sticks and buttons shrink, down to 0.6 of their size, and a touch that starts on the minimap and moves aims instead, since there the minimap covers much of where the aiming thumb lands; only a tap opens the map.
- The ship sprite **rotates to face the mouse**. Pixel art may look jaggy at odd angles. Start with free rotation, fall back to snapping to 16 directions if it looks bad.
- **Difficulty: gentle.** "Pretty bullets you can dodge", not bullet hell. Enemy projectiles are slow, readable and telegraphed.

## 4. The player ship

### Loadout and tiers

Three slots, four options each = 64 loadouts:

| Slot | Options (from Main Ship pack) | Gameplay role (tunable) |
|---|---|---|
| Weapon | Auto cannon, Rockets, Big space gun, Zapper (zigzag beam) | Different fire rate / damage / pattern |
| Engine | 4 engine variants | Speed / acceleration / handling trade-offs |
| Shield | 4 shield variants (incl. front, front+sides, round bubble) | Coverage vs strength trade-offs |

**Each weapon has its own advantage** (#72, @starquake: "Can we make the weapons have different advantages? Like make the missiles seeking missiles? And the bomb when exploding throw bullets in a star?"):

| Weapon | Advantage | Numbers |
|---|---|---|
| Auto cannon | Steady and precise | 1 damage every 0.13 s |
| Rockets | **Seek**: turn toward the nearest enemy within 60° and 400 px, up to 3 rad/s, so a jinking Scout can still slip one | 3 damage every 0.4 s, under the cannon's rate, since they need no aim |
| Big space gun | **Bursts** where the ball hits or after 150 px, into a star of 8 shards (the auto cannon's shot, recolored gold), seeded by the shot, so every screen draws the same star | 12 for the ball, then 2 per shard, 120 px out; the shards fly past the enemy the ball hit, so the burst is crowd damage, not a bigger single hit |
| Zapper | **Pierces**: the zigzag beam carries on through 2 more enemies after the first | 2 per enemy, 3 at most |

Tiers (below) raise each weapon's fire rate; the advantages stay as they are. Rockets that others fire are steered on each screen toward the enemies as it draws them, so a curve can differ a little between screens; only the shooter reports hits.

- Every new player starts with **one default part per slot**.
- **Parts are permanent unlocks.** Enemies drop part pickups. Collecting a pickup for a part you don't own unlocks it forever for your player.
- Loadout can be changed **anywhere, in a fight too** (#191, replacing the home-only rule of #6 and #78), with a half-second swap before a new weapon fires (`WeaponSwapSeconds`).
- Weapon/engine/shield *choices* should be sidegrades, never strictly better. A new player with defaults is useful in any fight.

### Tiers (getting stronger)

Decided in #6 (@starquake, 2026-09-29: "Should we consider upgrades. Doesn't it feel boring if you can't become stronger?"):

- **A part grows through three tiers: Super, Mega and Hyper.** A part starts plain ("Auto Cannon"). Picking up a part you already own upgrades it one tier: Super Auto Cannon, Mega Auto Cannon, then Hyper Auto Cannon, the cap.
- **Each tier adds about 15%** to that part's own strength: a weapon's fire rate, a shield's recharge, an engine's acceleration (tunable; @starquake picked 15 over 10: "Is the +10% enough? Shouldn't it be more?"). A Hyper part is about 1.45× a plain one, so each tier is felt in a fight. A veteran is stronger than a newcomer but never in a different league, and a newcomer with plain parts still pulls their weight.
- **The parts stay sidegrades of each other**: a Hyper Zapper and a Hyper Rocket are equals, and so are two plain ones. Tiers reward playing, not a best loadout.
- **Each tier has its own color**: Super blue, Mega violet, Hyper gold (#77's mockup). It tints the part on the ship, makes a pickup glow, and colors the part's slot in the HUD's gauge and its name under a player's name (@starquake: "We could use colors and show super mega and hyper in front of the name"). The packs have one sprite per part and no tier art, so tier colors are recolors, which the art rule allows.

As built (#77):

- **Drops:** a Scout drops a part 10% of the time, a Fighter 30%, and a boss always (#7). The part is one a player behind their squadron can use, else one a nearby player lacks, else one a nearby player can raise; nobody within 800 px able to use anything means no drop. A player below their squadmates' average level (a point per part owned and per tier) doubles the chance while nearby: catch-up drops.
- **Pickups** drift where the enemy fell, appearing with its explosion on the delayed timeline (#232), the Pickups Pack's icon glowing in the tier it would give you (plain parts don't glow, and one you have at Hyper is drawn faint). A pickup starts blinking after 20 s and is gone at 30 s.
- **Collecting:** a client reports flying over a pickup (the trust model), and the hub grants the part to the collector's whole squadron, wherever they are: each unlocks it or raises its tier. A pickup nobody in the squadron can use stays for someone who can. The HUD says who collected what ("Sanne: Mega Zapper").
- **Unlocks** are saved in the database (`unlocks`, #76) and sent in `Welcome`. Parts are fitted anywhere, with 1/2/3 or the gauge's drop-ups (§8, #191).

### Shields and facing

Because the ship faces the mouse, a **front shield blocks projectiles coming from the aim direction**. This rewards skill without extra art. The round shield covers all directions but is weaker (tunable).

### Health

- **3 hits and you're down.** The 4 damage-state sprites *are* the health display:
  1. Full health
  2. Slight damage
  3. Damaged
  4. Very damaged = downed
- Shields absorb hits on top of that (tunable per shield type).
- Health regenerates slowly out of combat (tunable).

As built (#46), in `internal/sim/damage.go`, the same Go code on the server
and in the browser's WebAssembly:

- A hit from inside the shield's arc, centered on the aim, takes one charge:
  the front shield holds 3 over 90°, front and side 2 over 180°, round 1 all
  around. Other hits, and hits with no charge left, cost a hull step.
- Bullets meet a charged shield where it is drawn, 21 to 25 px out
  (`ShieldStats.Radius`, from the sprites), on the side it covers; the
  rest fly on to the hull's 12 px.
- The shield recharges over its `Recharge` seconds once 3 s pass without a
  hit, twice as fast with a squadmate (a player or companion of the same
  squadron) within 200 px. After 8 s without a hit the hull heals one step
  every 10 s.
- The shield is drawn while it holds a charge and flashes when it takes one;
  the hull sprite shows the hits taken and flashes on each. Everyone draws
  everyone's, from `ShipState.shield` and `damage`.
- Each browser counts the hits on its own ship. The hub fires every enemy
  volley itself, from the seed it sends, and counts the hits on the
  companions it flies. Bullets that touch another player's ship end there on
  every screen, for the picture only.

### Bumping

As built (#48), in `internal/sim/bump.go`: ships and enemies don't overlap.

- Every ship bumps: players, companions and enemies. Overlapping bodies push
  apart along the line between their centers, and the one pushed loses its
  speed into the other. Two ships on one point, as at the spawn, part along
  x, each to its own side.
- A collision closing at 120 px/s or more is a ram. It counts from 8 px
  short of touching (`RammingReach`): each ship sees the other as it was, and
  the rammer's own client stops it at the touch, so the rammed ship would
  otherwise rarely see an overlap. It costs each ship a
  shield charge, if the shield covers the side it came from, or a hull
  step. An enemy takes 2 damage, like a zapper hit. The same two bodies ram
  at most once a second.
- Each client bumps its own ship against every other ship and enemy as
  drawn, and reports a ram on an enemy as a `Hit` with `shot_id` 0. The
  hub bumps its companions and enemies against each other and the players'
  latest states, and applies the companions' rams, so every ship is moved
  by whoever flies it.
- A downed ship won't bump once going down exists (#47).
- Friendly ships, players and companions alike, only push each other, never ram (#68, widened in #112): no shield charge or hull step on either side. Only rams between a friendly ship and an enemy hurt. @starquake, 2026-10-01: "companions keep bumping into eachother, maybe we should just remove that damage."
- Companions keep a little room from other friendly ships, so orders that
  send a wing to one place don't make it ram itself (see §13, "Keeping
  apart").

## 5. Going down (death without setbacks)

- At 0 health the ship is **downed**: it stays as the "very damaged" sprite, drifting slowly, unable to shoot.
- **Revive:** a teammate hovering near the downed ship for N seconds (tunable, ~3s) revives it at 1 health step.
- **Respawn:** a downed player can choose to respawn at the home planet, or next to a living friend, after a short delay.
- **Nothing is lost.** No currency, no parts, no tier. The only cost is time.

As built (#47), in `internal/sim/revive.go`, the same Go code in the browser and on the server:

- **Down** at 3 hull hits: the ship keeps the very-damaged hull, loses its shield and drifts. It can't thrust or fire, and it isn't hit, bumped or targeted: bullets pass it and enemies ignore it. It doesn't heal on its own.
- **Revive:** a friendly ship that is up within 100 px (center to center, about a ship and a half between hulls; 60 until #66) fills the revive bar in 5 s, a squadmate in 3 s; with nobody near, the bar drains back at the friend rate, so a helper has to stay (@starquake, 2026-09-29: "Isn't it too easy right now?"). The ship comes back one hull step up ("damaged"), with its shield recharging as usual. Everyone sees `DOWN` under a downed ship, and under it a gold bar filling with the revive progress once there is some (`ShipState.revive`, #66).
- **Respawn:** 3 s after going down, the downed player gets a panel: **H** respawns at home, **J** beside the nearest squadmate that is up, both with a whole hull and a full shield. Waiting for a revive stays possible. The panel also lists **C**, switch squadron, from the moment the ship goes down: switching squadrons is for the downed only (#45); on touch a Squadron button sits beside the respawn buttons. A move leaves the ship down and the respawn delay running (a takeover puts the downed ship in the companion's place), and J then picks a squadmate in the new squadron. **H docks the player's downed companions** in the hangar at once, ready for G (#271): the client tells the server with `RespawnHome`, since an H and a J look the same in the ship's state. A downed companion stays down to be revived instead when someone in the squadron will come: another player up within 800 px, who can choose to fly over, or a companion up (a squadmate's or one of the owner's own) that would come to revive it, within 400 px and in a mode that helps (not Hold or Stealth, not regrouping or going home; `sim.ComesToRevive`). The owner's ship doesn't count. J leaves them all down where they are.
- **Companions** fly to a downed squadmate within 400 px, their owner included, and hover 40 px beside it until it's up, in every mode but Hold and Stealth. A downed companion is revived the same way (its owner counts as a squadmate); after 60 s down it goes home to the hangar (30 s until #129, too short to respawn and fly back), its owner is told, and it leaves every screen, its owner's included. The 60 s still counts for one whose owner is up, or that waits for a revive; an owner who respawns with H no longer waits on it (#271).

## 6. Enemies

Each faction uses its 8 ship classes in these roles:

| Class | Role |
|---|---|
| Scout | Fast fodder, erratic movement, weak shots |
| Fighter | Standard fodder, strafes and fires at players |
| Bomber | Slow; drops large, slow, dodgeable projectiles |
| Torpedo Ship | Slow; fires telegraphed torpedoes |
| Support Ship | Shields/repairs nearby enemies — priority target |
| Frigate | Encounter boss (mini) |
| Battlecruiser | Encounter boss |
| Dreadnought | Siege boss (one per faction) |

- Enemy projectiles use the 5 projectiles from each fleet pack.
- Enemies use their pack's destruction animation when killed.
- Killed enemies may drop part pickups (drop rate tunable; favor parts the nearby players don't own yet).

As built in milestone 3 (#4), Scouts and Fighters, held in garrisons since #99 and by faction since #136, with Bombers and Torpedo Ships since #137 and Support Ships since #184:

- **Garrisons** (#99) replace the old spawning around players. Each sector but home holds one.
  - **Size:** 8 ships in ring 1, 12 in ring 2 and 16 in ring 3, with more Fighters outward (3, 6 and 10). That's for one player: each other player who enters adds half again, and each companion a quarter, counted once. Joiners add, and leavers take nothing away.
  - **Taking the field:** a garrison waits as a count until a ship comes within 400 px of its sector. Then it takes the field anywhere in the sector, at least 80 px in from its sides, up to 24 at once (a map can cap it lower), with reinforcements only where no ship can see them.
  - **Holding the sector:** it engages anyone inside and chases only within the sector. While nobody is in it, each ship roams from one random point in the sector to the next at 40% of its top speed (#121). After 30 s with nobody near it goes back to a count.
  - **Losses stay** until the sector is cleared, held in memory.
  - **A cleared sector** gets the odd straggler: at most one Scout a minute while someone is in it. The home sector is quiet.
- **Scout**: 2 HP, fast (150 px/s), wanders erratically and closes to about 90 px; fires one small bullet.
- **Fighter**: 6 HP, slower (95 px/s), strafes around its target at about 170 px; fires one big bullet.
- **Firing**: a garrison comes for the nearest player inside its sector, and stragglers for anyone within 500 px. They fire once within 340 px, where their bullets still reach, every so many ticks with jitter; every volley is telegraphed by the weapon animating for 300 ms before the bullets leave; bullets are slow enough to dodge (110–130 px/s), aimed with a small seeded spread. Enemy shots have their own soft laser (Kenney `laserSmall_004`).
- **Losing interest** (#166): a straggler with nobody up in reach turns away from the nearest downed player and flies off at its roaming speed, vanishing once it's 800 px from every player, so a downed group gets a quiet spell to respawn or revive. Garrison ships keep roaming their sector instead, and stand down after 30 s with nobody near (#99).
- **Factions** (#136): each ring's garrisons and stragglers are its faction's: the Kla'ed in ring 1, the Nairan in ring 2 and the Nautolan in ring 3 (`sim.FactionOfRing`). An enemy carries its faction beside its class, on the wire too (`EnemyFaction`), and draws from its faction's pack. The faction makes it tougher (#9 decision 14, `sim.FactionStats`): Nairan Scouts and Fighters have 1.5x the Kla'ed hit points and fire 1.5x as often, the Nautolan 2x. A hit still takes one hull step, so their shots also fly faster and keep about the Kla'ed reach: the Nairan fire Bolts (Scout, 140 px/s) and Rays (Fighter, 165 px/s), the Nautolan Bullets (Scout, 165 px/s) and Spinning Bullets (Fighter, 195 px/s). The Nairan Fighter and both Nautolan ships are wider, so their hit circles are too (14 and 15 px). The Frigates of the later rings are their faction's (#139), and so is ring 3's Dreadnought (#140).
- **Smarter by faction** (#138, #9 decision 15, `sim.FactionSmarts`); the Kla'ed fight as they always did.
  - **Leading** (Nairan, Nautolan): a volley aims where its target will be when the shots arrive, from the velocity it reports, the shot's speed and the warning (`sim.LeadAngle`). Only `EnemyFired`'s angle changes.
  - **Flanking** (Nairan, Nautolan): each ship draws a side of its target when it spawns and keeps its distance there, so a pack spreads out around you instead of coming from one side.
  - **Dodging** (Nautolan): a ship sidesteps a shot heading at it within 160 px, once the shot is 0.2 s old, for 0.4 s, then rests 1.5 s, so it can still be hit. The hub knows players' shots from relaying them and flies its companions' itself.
  - **Picking off the weak** (Nautolan): a ship goes for the most damaged ship within its reach, often a companion, rather than the nearest.
- **Bombers and Torpedo Ships** (#137), the slow heavy hitters: 10% of a ring-1 garrison (#185), 20% of a ring-2 one and 30% of a ring-3 one, half each, drawn after the Support Ships take their places.
  - **Bomber**: 10 HP (15 Nairan, 20 Nautolan), slow (60 px/s), keeps 240 px from its target. It fires a pair of shots, Kla'ed Big Bullets (130 px/s, the Fighter's), Nairan Rockets (80 px/s) or Nautolan Bombs (100 px/s), that leave 0.4 rad either side of its aim and curve back in to cross 240 px down it, where the target was; every client draws the same curve from the spawn. No pack draws a Bomber's weapons, so its hull glows blue for the warning.
  - **Torpedo Ship**: 8 HP (12 Nairan, 16 Nautolan), keeps 260 px off, then lines up and holds still for a 0.75 s warning, its weapons animating, before one straight shot: a Kla'ed Torpedo (56 px/s), a Nairan Torpedo (70 px/s) or a Nautolan Wave (88 px/s), each reaching about 420 px. A Torpedo takes two hull steps, or two shield charges; every other shot takes one. The Kla'ed Torpedo is drawn in the pack's own colors, its exhaust teal; every other enemy shot is recolored blue (#36).
- **Support Ships** (#184), every faction's, in every ring: 1 in 8 of a garrison, the second of every eight in its line-up (`sim.GarrisonSupport`), so the first ships a garrison sends out bring one.
  - **Stats:** 4 HP (6 Nairan, 8 Nautolan), slow (70 px/s), no guns.
  - **Staying behind:** while its pack fights, it keeps 180 px past the middle of its pack, on the side away from the ship they fight. Its pack is its faction's other ships within 400 px of that ship, Support Ships aside. With no pack there it stays out of the fight, roaming its sector.
  - **Repairing:** it repairs the most worn of the enemies within 200 px, a point a second, and stays on that one while it needs it and is in range. A Frigate's or Dreadnought's shield comes back first, then the hull, and nothing goes past where it started. Every client draws a thin green line from it to the ship it repairs (`EnemyState.repairing`).
  - **Priority target:** the companions' "Support first" order goes for it first, and conserving, the big space gun saves its volleys for it.
- **Enemy fire stands out** (#36): the Kla'ed bullets are drawn in a blue recolour of the pack's orange ones (`tools/recolor.py`, a palette swap), and they glow blue. Every faction's shots get the same blue (#136). Players' shots stay orange. The glow follows the F effects toggle. Since #143 the glow is baked once at boot into a glowing copy of each bullet sheet, the same math the old glow filter ran over a full-screen layer every frame.
- **Death**: the pack's destruction animation, and an explosion sound when it happens in view. No drops yet (pickups are milestone 5).

## 7. Bosses and scaling for 1–16 players

### Encounter bosses (Frigate, Battlecruiser)

- Normal fights, a few minutes long.
- **Health scales with the number of players** online (#132; it was the players nearby until then).
- Reset if everyone leaves or goes down.

**The Frigate, as built (#89).** One patrols each Frigate sector of the game map (`internal/world`, chosen with `MAP`), with three Fighters that keep station around it while it's there. It spawns at a random spot at least 200 px in from its sector's sides and drifts at 20 px/s from one random point in the sector to the next, holding still while any ship is within 380 px (#121). Bumps don't move it. It turns to the nearest ship and fires a ring of 12 big bullets every 3 s at anyone within 380 px.

**The later factions' Frigates (#139).** The map puts 3 in ring 1 (D3, E4, C4), 4 in ring 2 (E2, F5, C5, B3) and 6 in ring 3 (E1, G3, F6, C6, A4, B2): every other or every third sector, between the ones inside them. A Frigate is its ring's faction (`sim.FactionOfRing`) and comes only once its ring is open. A Nairan or Nautolan one has two Fighters and a Bomber as escorts. Its ring is its faction's big shot, as many more as the faction fires more often (`sim.FrigateRing`): 18 Nairan Rays, 24 Nautolan Spinning Bullets. Its health, shield and fight are a Kla'ed Frigate's (#9 decision 14 leaves the bosses' health as #132 sized it), and the boss bar names its faction.

- **Health**: 40, plus 30 for every player online, downed or not, a companion counting half (#132). When someone logs in or off it keeps its share of health left, so it doesn't jump when ships fly in, fly home or go down. A group that splits up meets a Frigate sized for everyone.
- **Shield**: a bubble that takes 20 damage before the hull, and recharges all at once after 8 s without a hit.
- **Reset**: once nobody within 800 px is up, it heals fully and its shield comes back.
- **Destroyed**: it always drops a part for the players near it, and is back at its spot 5 minutes later.
- **The bar**: within 800 px, a health bar at the top of the screen shows its name, its health, and its shield as a thin blue line. Until #223 it also showed the players online its health was scaled for; no boss bar does now. The HUD's gauge sits bottom left and its panel top left, clear of it.

### Siege bosses (Dreadnought)

- One per faction, guarding the path to the next ring.
- **Persistent health** stored on the server. It does not reset when players log off.
- A solo player beats it in about 20 minutes, twelve friends in about 15 (#223, replacing "a busy evening finishes it").
- **Slow regeneration** (tunable) so it's not purely a grind, and concentrated group effort matters.
- Defeating it **unlocks the next ring permanently** for everyone.

**The Kla'ed Dreadnought, as built (#124).** It wakes once 4 of ring 1's 6 sectors are cleared, in a ring-2 sector drawn at random, which opens on its own while it's awake. It's the pack's 128 px sprite, twice a Frigate, and it holds still.
- **Health, sized from measured damage (#132, #223):** its maximum is 1,100 plus 2,900 for every player online, downed or not, a companion counting half, so a player at a dodging companion's rate, a "perfect" player, beats it in about 10 minutes alone and twelve in about 7.5; a player who dodges less takes longer. The numbers come from `TestDreadnought_DamageRate`, which flies a wing of companions against it for 5 simulated minutes per weapon and tier: averaged over the four weapons at plain tier, a ship takes about 400 health off a minute, its time down included, now that companions dodge (#249; 333 on the test's own seed, 400 over 24 seeds, and 258 before dodging). `base + perPlayer = 10 × 400` and `base + 12 × perPlayer = 12 × 7.5 × 400` give 1,091 and 2,909, rounded. The hub logs each ship's damage to a Dreadnought once a minute while it fights it, and at its fall (`dreadnought damage`), so real play can be read back against this. What's saved is the share of its health left, with the time of the save, every minute while it's awake and when it falls. Its maximum follows whoever is online now: a friend logging in raises its health in proportion, a friend logging off lowers it, and the share stays as it was. It regenerates 1% of its health an hour, the hours nobody was on included, up to full.
- **Fight:** it fires at the nearest ship within 520 px, taking its volleys in turn: a ring of 12 big bullets; a Ray sweep of 6 beams across 1.2 radians, each beam 6 Ray segments, 0.3 s apart; then a spread of 5 Waves across 0.9 radians, 2 s between them. The Ray and Wave are the pack's, recolored blue like all enemy fire. A shield bubble takes 120 damage first and comes back after 8 s without a hit. Each volley's seed says which it is, so every client expands it the same way.
- **On screen:** the boss bar names it, and the maps mark its sector with a bigger triangle than a Frigate's.
- **Its sector** (#223): while it's awake there, the sector's own garrison stays off the field, and one already out stands down, so the Dreadnought alone guards it. No world attack comes to that sector while it's awake, and the development key K refuses it too.
- **Its fall** opens ring 2 (#140, replacing #8 decision 12's rings 2 and 3 together) and saves a fresh Dreadnought's health for the next time one wakes. Every player who is up within 800 px of it gets a part, and 3 derelicts wait free around the wreck (#125). Everyone sees a banner, with the part they won. It also clears its sector at once (#223), however much of the garrison is left: the clear's banner and reward, saved, and one of the 4 cleared sectors that wake the next Dreadnought. A sector cleared before, when its ring was last open, stays as it is. The finale's sector is cleared before the season is won, so the result counts it.
- **Ring 1 falling back:** whenever fewer than 4 of ring 1's sectors are cleared while ring 2 is open, ring 2 and everything beyond it close again, with a banner, and a fresh Dreadnought at full health wakes once ring 1 is back at 4 (#8 decisions 9 and 10). Cleared sectors beyond the closed ring stay cleared.
- **Raids** (#223): the Kla'ed Dreadnought raids ring 1 and the Nairan one ring 2; the finale doesn't.
  - **When:** once the raided ring has a sector cleared, every 10–15 minutes (drawn), while a player is up in a hostile sector of it. The clock starts again after each raid, and whenever no raid may come: while the ring's Dreadnought is awake at its gate, after it has fallen, or with the season won.
  - **Where:** in the hostile sector a player is in, drawn among them, at least 600 px from every ship. A banner and a warning sound (the teleport's, an octave down, twice) go to everyone 4 s before it appears. It brings no escort, and the sector's garrison is unchanged.
  - **The fight:** its usual volleys and shield. Its health is the same saved share as the gate fight's, and the damage stays on it. Its boss bar reads RAID, and nothing on screen says how to drive it off, so that stays a surprise: the warning banner only says it's coming.
  - **Leaving:** it teleports out once it has taken a tenth of its maximum health this visit, after 2 minutes, or when every ship within 800 px of it is down. Driven off by damage, it gives every player up within 800 px a part, as at its fall; it never falls during a raid. Its gate waking calls a raid off first, keeping its share.
  - **The teleport** is the derelict's (#190), scaled to its 128 px.
  - **On a development server**, **U** sends a raid at once to the hostile sector you're in, whatever the clock says. The E2E map's Dreadnought is awake from the start, so it never raids there; hub tests cover raids.

**The Nairan Dreadnought (#140).** It guards ring 3 as the Kla'ed one guards ring 2: it wakes once 4 of ring 2's 12 sectors are cleared, in a ring-3 sector drawn at random that opens for it, and its fall opens ring 3. It's Fleet Pack 2's 128 px Dreadnought. Its health and its scaling to the players online are the Kla'ed one's, and its share of health is saved apart, keyed by faction (migration 007). It fires its own faction's shots in turn: a sweep of Nairan Ray beams, a spread of 5 Rockets, and a fan of 3 Torpedoes across 0.3 radians in place of the ring. Ring 2 falling below 4 cleared closes ring 3, and an awake Dreadnought beyond a ring that closes goes back to sleep, keeping its share.

**The Nautolan Dreadnought, the season's finale (#153).** It wakes once 4 of ring 3's 18 sectors are cleared, in a random ring-3 sector, which is open already. It goes back to sleep, keeping its share, if ring 3 falls below 4. It's Fleet Pack 3's 128 px Dreadnought, and it fires Nautolan Ray sweeps (the pack's Ray, recolored blue), spreads of 5 Waves, a ring of 24 Spinning Bullets, its Frigate's ring, and a spiral of them (#273). Its fall wins the season: the time is saved (`season.won_at`, migration 008), and it doesn't wake again until a new season.
- **The spiral** (#273): a burst of 3 bullets, 120° apart, every 0.1 s. The bursts turn one full circle in 1.6 s, and each spiral turns the other way. The first burst always points straight up, never at a ship. Every fourth burst (bursts 2, 6, 10 and 14, counting from 0) is a pause, so a spiral fires 12 bursts and 36 bullets. The bullets can fly 48 paths, 7.5° apart, and the pauses leave every fourth path empty. These are the same 12 paths in both turn directions, so a spiral always has 12 holes, 15° wide, in the same places around the Dreadnought. A ship that stands still in the middle of a hole is not hit from 150 px out; at 265 px out the safe spot is 39 px wide. A ship also fits between neighboring bullets on an arm: outside the hull, they are always more than 30 px apart, twice a ship's and a bullet's radius together. Its turn is ring, Ray sweep, spiral, Wave spread, which keeps its two volleys of Spinning Bullets apart. Its weapon animates once, at the first burst. Each burst is its own `EnemyFired`, so every client draws the same spiral.
- **Fire rate by faction** (#10 decision 8): every Dreadnought's gaps between volleys and beams are divided by its faction's shots multiplier (`sim.FactionStats`). The Kla'ed one waits 2 s after a volley, the Nairan one about 1.35 s and the Nautolan one 1 s. The spiral's 0.1 s between bursts is not divided. Their health stays the same, so each fight still takes about 15–20 minutes (#223).

## 8. World structure: the frontier

- **37 hexagonal sectors**: home and three rings around it, flat-top hexagons 990 px from center to corner, about the area of the 1,600 px squares they replaced (#117, built after #99's 7 × 7 grid).
  - Sectors are named on a column-and-row grid with home in D4: ring 1 is D3 above home, E3, E4, D5, C4 and C3 clockwise. Columns run A to G, and the rows of the outer columns are shorter (A2 to A5).
  - The world's edge is a hexagon 5,445 px from home to each side, through the outer sectors' far corners.
  - The HUD's panel names the sector you're in, with its state ("B3, hostile", "cleared" or "the home sector"), and faint lines outline each sector.
  - The grid's geometry is a sim rule (`internal/sim/sectors.go`), shared by the server, the client and the WebAssembly sim.
  - The game map (`internal/world`, `MAP`) holds what's in each sector: boss sectors (the `frontier` map puts a Frigate in alternate sectors of ring 1: D3, E4 and C4), garrison overrides and derelict spots.
- **A sector is cleared** once its garrison is destroyed, and its Frigate too in a boss sector.
  - Everyone is told ("Sector C3 cleared"), and the server keeps it in its database (`cleared_sectors`) across restarts.
  - A cleared boss sector's Frigate doesn't come back.
  - **Every clear rewards the whole server** (#101): one ship to the shared hangar, within the 16-ship cap, and a part for every player online, named in the notice ("Sector E4 cleared · Mega Zapper").
  - The maps come with #100.
- **World events** (#102): one at a time, about every 5 minutes while anyone is online. Each is announced in a banner, named on the HUD with its time left ("D3 under attack · 9:12 to save it", "Distress call in C4 · 1:42"), and pointed at by a red arrow at the screen's edge.
  - **An attack:** a Frigate and a ring-sized garrison come at a cleared sector next to hostile space. Destroy them all within 10 minutes and the sector holds, adding a ship to the hangar. Otherwise it falls: it's forgotten as cleared and gets a fresh garrison. Its start banner warns of that, and the warning shows once more as a banner at 1:00 left, for everyone who saw the attack with more time on the clock (#272).
  - **Offline attacks:** with nobody online, an attack comes every 4 hours and runs an hour, so given long enough away everything but home goes back.
  - **A distress call:** when nothing can be attacked, a derelict (#52) waits with a guard of 3 in a sector next to cleared ground or home, held until the guard is gone (#114). Rescuing it wins the call, and the derelict itself is the reward, with a part for whoever is near. The call lasts at most 10 minutes; once the derelict is freed, it ends with the derelict's 2 minutes instead.
  - A map can keep events away (`noEvents`); the E2E map does, since its specs share one server.
  - **On a development server**, **K** starts an attack at once on the cleared sector you're in, in place of any event running, for trying events and for E2E (#176).
- **Missions** (#101): each squadron has one, shown to everyone.
  - **The default:** the uncleared sector in the ring nearest home, nearest the squadron, so ring 1 comes first.
  - **Picking another:** a squadmate clicks another uncleared sector on the full map to send the squadron there (#100). When the sector clears, the squadron gets its next default.
  - **On screen:** the HUD's panel says "Mission: Clear sector D5", and a gold arrow at the screen's edge points to it while you're elsewhere.
- **The maps** (#100), drawn from what the client already knows:
  - **The minimap** sits small in the top right, always: every sector, home blue, cleared green and hostile red darker by ring; a coral triangle for each Frigate still up; your squadron's mission outlined in gold and the others' in violet; a white dot for you and dots for your squadmates. A line under it names each squadron's mission. A sector under attack flashes on both maps.
  - **The full map** toggles on M (Tab until #167 decision 7), with Esc closing it too. It adds the sector names, a title with ring 1's progress, and a legend. While it's open the world runs on, the ship holds still, and the HUD hides. A click on an uncleared sector sends your squadron there.
- Camera follows the player, parallax backgrounds from the Environment pack. No texture is over 4096 px, so older GPUs hold them all (#222): the void's frames are a 3 x 3 grid; each stars layer is one still piece plus the regions that animate, drawn into a 640 x 360 texture the layer tiles; the planet is cropped to its glow and laid out 9 to a row; the Dreadnoughts' strips keep each different frame once, cropped around its center, and each animation lists the frames it plays, so it plays the pack's exactly (#236) (`cmd/cutsheets`).
- **Home planet** at the center of D4 (Environment planet). Spawn point, safe zone, where companions are summoned.
- **Switching parts** (#191, replacing #78's loadout screen): anywhere, in a fight too. A tap of **1**, **2** or **3** cycles the weapon, engine or shield through the parts the player owns (`nextPart`), on key-down; on a development server, and offline, they cycle every part. A click or tap on one of the gauge's slots (#91) opens a drop-up of that slot's owned parts above it, their icons in one column with the slot's, each with its name in its tier's color and a few words on what it does (`PART_HINTS`); a click on one fits it, and Esc or a click elsewhere closes it. A tap of a key also opens that slot's drop-up, which shows the fitted part (#259). Each next tap fits the next part, and the list stays open. It closes 2 s after the last tap (`PART_LIST_IDLE_MS`), or at once on Esc. Another slot's key switches that slot and opens its list instead. A held key does nothing more. A list only the pointer has used stays until it is closed. A new weapon waits out a half-second swap before it fires (`WeaponSwapSeconds`). The server saves any loadout made of owned parts, wherever it's fitted, and a player's next visit starts with it.
- **Three rings** around it, bands of sectors by distance from home:
  1. Kla'ed space: the 6 sectors around home
  2. Nairan space: the next 12
  3. Nautolan space (the third pack): the outer 18
- Each ring gets its own **tinted background** so it feels distinct (recoloring allowed). As built (#136): ring 2 green (`0x8fe0b0`) and ring 3 blue (`0x8fb4ff`), the background layers fading to the ring the ship is in over 1.5 s.
- **Closed rings** (#123, #140): only home and ring 1 are open until the Kla'ed Dreadnought falls, which opens ring 2; the Nairan Dreadnought's fall opens ring 3. The server keeps the open rings in its database and sends them, with any sector opened on its own (the Dreadnought's while it's awake), as the `Frontier`.
  - A closed sector pushes a ship back like the world's edge, in a 200 px band, and stops it at its side. The browser's sim and the server's companions both apply it (`sim.ApplyFrontier`).
  - Nothing happens in one: no garrison wakes, no straggler, attack or distress call comes, and no mission goes there; a pick of one is refused.
  - In the world a closed sector is shaded; on the maps it's gray, and the HUD line says "closed".
  - Its sides with open ones carry a force field (#127): two red strands rippling out of step in a soft, flickering glow, which ripples wider, brightens and throws sparks near a ship. The field starts to flare 340 px from a ship, which reaches past the push-back band. Only the sides within 450 px of the ship are drawn each frame, since drawing every side costs too much; with effects off (F) it's one plain strand. A ship inside the band hears an electric zap, at most every 0.6 s and louder the deeper it is (Kenney's `forceField` sounds).
- Asteroids (Environment pack) as obstacles/cover.

### Season

- **A season lasts as long as the host likes** (#10 decision 13): it ends when the finale falls, and the host starts the next, after a weekend or a single day. How long the rings and bosses take is still to be timed in a playtest (#160).
- **The Nautolan Dreadnought's fall wins the season** (#153). The world stays open afterwards: no ring closes again, even if attacks retake sectors.
- **Season stats** (#154): the server counts each player's own kills, shots and hits, their companions' kills, how often they went down, the derelicts they docked, and the sectors cleared with them in it (#10 decision 9). A piercing shot counts as one hit, and a burst's shards as none. The counts are saved per player (`season_stats`, migration 009) every 10 s while they change, when the player leaves, and when the server stops.
- **The season so far** (#167): the server sends the standings (everyone with stats, and the season's start) in `Welcome` and whenever stats changed, every 10 s at most. A "Season so far" table shows the top 5 by kills plus your own row, with kills, hit rate and kills / deaths, under the squadron list on the join screen, and above the "You're down" panel while down or while Tab is held (decision 6). Each garrison notes a player's stats when they first come into its sector, and its clear (`SectorCleared`) carries what each did there; the "Mission complete" banner names the most kills, the best aim over at least 10 shots, and who went down.
- **The victory screen** (#156): the finale's fall sends everyone the season's result (`SeasonWon`): how long it took, the sectors cleared, and the stats of everyone who did anything, loaded from the database at start for those offline. A player joining a won season gets it in `Welcome`. The screen opens at the fall, and once per season for a joiner (the browser remembers the season it showed, by its start), and O reopens it. It's an HTML form over the game like the settings screen, the ship holding still under it while the world plays on. A development server sends it on request (`DevSeasonWon`, key Y) without winning anything, for E2E.
- **A new season is started by hand**, with the server stopped. It resets the frontier, the boss health, the hangar and everyone's part unlocks, so a friend who missed a weekend isn't behind (#10 decisions 5–7). As built (#155): `voidmarch -new-season` runs `store.NewSeason`, one transaction that deletes the cleared sectors, the frontier, the Dreadnoughts' health, the hangar, the unlocks and the season stats, clears every loadout, and starts the season record now. A deleted row reads as a fresh file's: ring 1 open, the Dreadnoughts whole, `POOL_START` ships.

## 9. Technical architecture

### Overview

- **Server:** Go. Authoritative for the world state: enemies, bosses, frontier, player unlocks, persistence.
- **Client:** browser, HTML5 canvas, served by the Go server. Keep it simple (plain JS or TypeScript, no heavy framework needed).
- **Transport:** WebSockets.
- **Persistence:** a database for persistent state (frontier progress, Dreadnought health, player unlocks). SQLite is a good fit.

As built for the client's delivery (#227, #230, #238): the server embeds the client and gzips its code, wasm, CSS and HTML. `index.html` links every file under `/static/v/<build>/`, where the build is a hash over every served file, so a deploy that changes no file keeps the build. The running build's files are served `immutable` for a year, so a return visit asks the server only for `index.html`; relative URLs (the game's imports of its vendor modules, `style.css`'s fonts) and the client's own (it takes the prefix from its module URL) inherit the build. `index.html`, unversioned URLs, an older build's URLs and files served from disk (`WEB_DIR`) revalidate against a content-hash ETag instead.

### Trust model (friends only)

Because all players are friends, **trust the client** for:
- Its own movement.
- "I got hit" detection.
- "I hit enemy X for Y damage" reports.

The server applies damage reports to enemies/bosses and broadcasts results. This avoids lag compensation complexity.

### Networking

- Server tick rate ~20 Hz (tunable). Broadcast snapshots of nearby entities.
- Client-side interpolation for other players and enemies.
- **Deterministic enemy bullet patterns:** the server sends "enemy E fires pattern P at tick T with seed S" and each client simulates the projectiles locally, instead of streaming every bullet.
- **Interest management** (#231): each player is sent only the enemies near their ship or companions, and every boss; see *Enemies* below.

As built in milestone 2 (#3):

- **Protocol**: WebSocket at `/ws`, Protocol Buffers (`proto/voidmarch/v1/messages.proto`) in binary frames, or protobuf JSON in text frames per connection for debugging.
- **Ships**: each client sends its ship's state 20 times a second; the server keeps the latest and sends everyone a snapshot of the others every tick. Clients draw other ships 2 to 5 ticks (100 to 250 ms) in the past, blended between snapshots: the delay follows the measured jitter (the 95th percentile of how late snapshots arrive, plus a tick), and the render clock runs up to 10% slower or 5% faster to change it without a jump. When snapshots run late, a ship flies on along its velocity for up to 150 ms, and a correction from the next snapshot fades out over 100 ms (#232).
- **Shots**: a shot is one message; the server stamps it with its tick and relays it; every client simulates the projectile from that spawn (position is a pure function of spawn and age), on the same delayed timeline as the ships.
- **Enemies** (milestone 3, #4): the server runs them at the tick rate and sends their positions in each snapshot; clients draw them on the same delayed timeline, with the same extrapolation. A shot is one `EnemyFired` message (enemy, tick, seed, angle), announced 6 ticks ahead: clients animate the weapon from then, and at the tick expand the seed into bullets from the enemy's position in that tick's snapshot, with the same seeded pattern (`frontend/src/sim/patterns.ts`). Clients skip volleys from enemies more than 800 px away, which they could neither see nor be hit by. A client that sees its own shot touch an enemy sends a `Hit` (damage capped at 12); the server applies it, tells the others the shot ended (`ShotEnded`), and announces `EnemyDestroyed` when the HP runs out. Both carry the tick of the hit, so the others see them on the same delayed timeline as the shot and the enemy. Each client checks enemy bullets against its own ship; since #46 the hub also fires each volley with a companion within 800 px of the enemy, from the enemy's position at the volley's tick, and checks it against the companions.
- **Interest** (#231): a snapshot carries only the enemies within 1200 px of the player's ship or any of their companions (`sim.InterestRadius`), kept until they're past 1400 px (`sim.InterestMargin`, so one at the edge doesn't come and go every tick), plus every boss, which the maps and the boss bar show from afar. 1200 px covers the widest view (a 32:9 screen's half-diagonal, about 990 px) and the 800 px volley range. `EnemyFired` and `EnemyDestroyed` go only to the players who were sent that enemy in the last snapshot; `ShotEnded`, the other players, companions, derelicts and world news still go to everyone. An enemy that leaves a player's snapshots is dropped quietly on the client, as a despawn is. `BenchmarkHub_SnapshotBytes` (`internal/game/interest_test.go`) measures the issue's world, 16 players in four groups of four and 386 Scouts over the other sectors: 7,733 bytes per snapshot (151 KiB/s per client) with every enemy, 615 bytes (12 KiB/s) with interest. Its Scouts stand still, with no velocity on the wire, so real snapshots are larger; the ratio is the point.
- **Players**: name and token in the database (#76); a client whose token the server doesn't know is asked for a name again. At most 16 players; a player silent for 10 s is removed (a hidden tab keeps sending, #57); a client too slow to keep up is dropped rather than slowing the others.

### Persistent state (at minimum)

- Players: id, name, token, unlocked parts, current loadout.
- Frontier: which rings are unlocked, current season.
- Dreadnoughts: the share of health left per faction, last update time (for regeneration).

Enemies roaming the world do not need to be persisted; respawn them on server start.

As built (#76): a SQLite file (`DB_PATH`, `internal/store`, the pure Go `modernc.org/sqlite` driver) with embedded migrations. It holds players (id, name, a hash of the token, the loadout columns, created and last-seen times), their unlocks (part and tier, filled from #77) and the fleet, every companion ship, saved whenever it changes and started from `POOL_START` only on a fresh file. Registrations are limited to 20 a minute per address, more than a full server, since friends on one network share an address, and a name never used to play is deleted after a day (#19). Behind a reverse proxy, `TRUSTED_PROXY_IPS` makes the limit count the client in the proxy's `X-Forwarded-For`.

### Identity

- Friends only: a player picks a name on first visit, the server issues a token stored in the browser. No passwords.

### Frame rate on modest hardware (#143)

The game is played on laptops, so the effects are built to stay cheap at 120 Hz on an integrated GPU (a Ryzen 5 7640U with Radeon 760M was the measure) without looking any different:

- **Bloom** runs its threshold and blur at half the screen's size (`frontend/src/scenes/resample.ts`); only the halo layer is smaller. Since #234 the threshold runs in the halving pass and the blend adds the half-size halo back smoothly, without a full-size pass between; it rounds as the dropped passes stored, so the glow differs by at most 1/255 on under 1% of the pixels.
- **The enemy-fire glow** is baked once at boot (`frontend/src/glow.ts`), not filtered every frame.
- **The vignette** is a stretched overlay of black at the filter's darkness (`frontend/src/vignette.ts`), drawn on the HUD camera over the bloomed world.
- **The minimap** redraws its markers ten times a second while the full map is closed. Its hexagons are drawn into a texture, redrawn only when they look different (#265): Phaser re-tessellates every shape of a Graphics every frame.
- **The sector edges and the closed sectors' shade** in the world are drawn only for the sectors near the view, and redrawn when those or the frontier change (#265).
- **Settings** (#145): a screen on Esc holds the options that were single keys: sound, music, controls, rotation, effects, a 60 fps cap and rendering at CSS pixels instead of device pixels. It opens only when no other screen, the map or the join screen is up, and the ship holds still under it, as under the victory screen. Each change applies at once and is remembered in the browser. The keys M, N, C, R, F, V and P are free again (@starquake: "we are going to use them for other stuff"). Touch has a Settings button in the top left, beside the fullscreen switch.
- **Software rendering** (#234): where WebGL draws on the CPU (SwiftShader, llvmpipe, Microsoft Basic Render, read from WebGL's renderer name), effects start off, since the bloom costs about 40% of each frame there. Only the default changes: effects the player picked in the settings win, and every device with a GPU, or without WebGL, starts with them on. It is the one automatic downgrade (#143 has none), for devices that run the game at about 22 fps.
- **Measuring:** the debug state and the HUD carry the average and worst frame time of the last second, and the GPU's time per frame where the browser offers `EXT_disjoint_timer_query`.

## 10. Go conventions

- Prefer the **standard library**; use a third-party library only when it really is a better option (e.g. a WebSocket library, since the stdlib has no WebSocket server; an SQLite driver).
- Idiomatic Go following the Google Go Style Guide: <https://google.github.io/styleguide/go/> and the standard library's style.
- Use one of the official module layouts: <https://go.dev/doc/modules/layout> (a server project: `cmd/` for the binary, `internal/` for packages).
- Always handle errors. Never shadow `err`. Always wrap errors when returning them (`fmt.Errorf("...: %w", err)`).
- Tests with real databases (e.g. a temporary SQLite file), not mocks, unless mocking is the only option.
- Test assertion style:

```go
if got, want := err.Error(), "error creating question"; !strings.Contains(got, want) {
	t.Errorf("err.Error() = %q, should contain %q", got, want)
}
```

## 11. Milestones

1. **Single-player sandbox:** canvas client, one ship flying with WASD + mouse aim + shooting, parallax background, nearest-neighbor rendering of Void sprites.
2. **Multiplayer movement:** Go server with WebSockets, several browsers see each other fly and shoot.
3. **Enemies:** Kla'ed fodder (Scout, Fighter) spawned by the server, killed by players, destruction animations.
   - **Companion ships** (§13) follow, in slices alongside milestones 2–6.
4. **Health, downed state, revive, respawn.**
5. **Pickups and loadouts:** part drops, permanent unlocks, loadout changes (at the home planet then, anywhere since #191), persistence.
6. **Encounter boss:** Kla'ed Frigate with player-count scaling.
7. **Siege boss:** Kla'ed Dreadnought with persistent health and regeneration; unlock ring 2.
8. **Rings 2 and 3:** Nairan and Nautolan factions, tinted backgrounds.
9. **Season end and reset.**
10. **Later:** asteroid mining, escort missions.

Sound and music arrived with the sandbox (#14), ahead of the milestones: Kenney's Sci-Fi Sounds for effects and Foozle's Explorer Chiptunes for music. #187 replaced the music with Juhani Junkala's 5 Chiptunes (Action), one track for each place.

## 12. Open questions

- Stats for each weapon, engine and shield.
- ~~Do personal unlocks reset at season end?~~ Yes, so a friend who missed a weekend isn't behind (#10 decision 6).
- ~~Dreadnought health and regeneration numbers~~: scaling with the players near it (#132), sized from the measured damage rate to about 20 minutes alone and 15 for twelve (#223).
- Map size and how rings are separated.
- ~~Sound and music~~: decided in #14 (Kenney Sci-Fi Sounds, Foozle Explorer Chiptunes and Eerie Space Music, all CC0); the music has been Juhani Junkala's 5 Chiptunes (Action), CC0, since #187.

## 13. Companions

Companions are AI-flown wingmates. They make playing alone, or with one friend, feel like playing with the group, and real players replace them as they come online.

- **A companion is a player seat driven by an AI brain instead of a keyboard.** The brain produces the same move, aim and fire command as the keyboard and mouse. The ship is an ordinary player ship: same physics, weapons, shields, health, going down and revive. The server flies every companion (#51), so a companion keeps flying whoever is online, and on the wire they are players with an owner.
- **Where from** (#49): one hangar pool for the whole server holds the companion ships waiting at home. G at the home planet draws one, first come, first served; a companion that goes home, or whose player drops, docks back into it. Players and companions come from different pools: a joiner who takes a companion's place (a takeover, or displacing one from a full world) holds that ship until they leave, so joining and leaving never add companions. The pool starts at `POOL_START` ships (3 by default) and is kept in the store across restarts (#6).
- **Rescues grow it** (#52, as built). A derelict waits beside every Frigate, 160 px below it and towed along on its patrol, from the moment the Frigate spawns (#114): the Main Ship's "very damaged" hull, grayed, labeled "DERELICT" with the time left.
  - **Held:** while any enemy is within 600 px it is held: a darker hull, "DERELICT · HELD BY n" counting the enemies near, no timer and no rescue. The first time none is near it is freed, for good, and its 2 minutes start. A Frigate spot has one derelict at a time: a Frigate that comes back brings a new one only once the last is rescued or gone.
  - A player or companion hovering within 100 px for 5 s rescues it into the hangar, the way a revive works. Companions go to one within 400 px, except in Hold and Stealth. A bar under the label shows the progress, which drains when nobody is near.
  - An unrescued derelict drifts off 2 minutes after it was freed.
  - **It teleports away** either way, rescued or drifting off (#190): the Main Ship's Invincibility Shield, tinted blue, closes round the hull, then hull and shield turn light blue and shrink into a flash that collapses to a point, over 1.2 s, with Kenney's `laserLarge_002` heard within about a view. The client needs no message for it: a derelict missing from a later snapshot has left.
  - The fleet (hangar plus companions out) is capped at 16, the server's seats. Derelicts still come while it's full: a rescue then counts (for the stats to come) but adds no ship, and says the hangar is full (@starquake, 2026-10-01).
  - A map can also mark derelict spots that always have one waiting; only the E2E map uses them today.
  - A won fight, a cleared sector or a finished world event, adds ships with #90.
- **How many:** up to 3 per player, and at most 4 ships per squadron, companions included (#42 replaced the earlier "wing within one screen" cap). Companions are full seats: they count toward the 16-player cap, and a human joining a full world takes one over or displaces one, so the group, and its difficulty, stays the same whoever flies each ship.
- **Summoning** happens at the home planet. **A companion picks its own loadout, balanced across the squadron** (#6, decision 13; @starquake: "some should have a zapper, some have missiles"; as built in #79). In each slot it takes the owner's unlocked part that the squadron's ships use least, ties going to the higher tier, at the owner's tier. So an owner with more parts has a more varied, stronger wing. G summons one inside the safe zone, and so does the touch Summon button.
- **Looks:** the Main Ship sprites, tinted per owner. Orders and names are HUD text; no new art.

### Joining and leaving

- **A joining player chooses:** take over an online player's companion, or start as their own ship.
  - A takeover inherits the companion's position, velocity, health and current order, but flies the joiner's own loadout. The companion disappears, and its owner sees who took it.
  - A downed companion can't be taken over.
- **The squadron cap holds.** A human joining a squadron at 4 ships takes over its newest companion (never one mid-revive, once revive exists).
- **Dropping out mid-fight** leaves an AI in the seat, owned by the nearest friend, until the fight ends.
- As built (#28, trimmed by @starquake: "Trim it"): a dropped player's ship leaves at once, but their companions fly on as seats under the order Go home, from where the player was last seen. Each docks in the hangar on reaching the safe zone, or 60 s after the drop. A player back before then gets them back: they drop Go home and rejoin the squadron's mode once the player picks a squadron. The dropped player holds no seat meanwhile, their companions do. The seat in the AI's hands, and the squadron flying home, are set aside.

### Squadrons

As built (#42), from @starquake's "We need some more mechanics around the groups":

- **Everyone flies in a squadron** of at most 4 ships, companions included. On joining, a player picks a squadron with room on the join screen, or starts a new one. With nothing to pick, they start their own, so 16 solo players make 16 squadrons.
- **Greek names**, the first free one: Alpha, Beta, Gamma… An emptied squadron frees its name.
- **The join screen** lists the squadrons with room, the most players first, with seat marks and what joining means. A squadron at 4 ships means taking over its newest companion, and starting where it was. Full squadrons are only named. The last squadron flown is picked, and Enter joins it.
- **Moving squadron** (#45): only while down (decision 3), C, or the down panel's Squadron button on touch, reopens the join screen. It lists the player's own squadron too, marked as theirs with Stay; Stay, Esc, C or a tap beside it closes it without moving, and so does a revive. While flying, C does nothing. A move follows the joining rules, the mover's companions coming along as far as there's room, and a toast says where they moved. Those left over dock: the downed ones first, then the newest, so the ones that come along can fly (#271).
- **Orders are the squadron's.** Anyone's order is a callout for their squadmates, and every companion in the squadron follows it. The HUD names the squadron, its players, companions and mode, and players' labels show their squadron.
- **Reasons to fly together** come with health and loadouts: shared part drops (#6); respawning next to a squadmate, faster revives between squadmates and a shield bonus flying together (#5).

### Difficulty

- A companion counts as **half a player** for encounter-boss health (§7).
- When a companion becomes a human mid-fight, the boss gains the missing half player of health, so a takeover never makes a fight easier.
- A pickup a companion collects goes to its owner, only for parts the owner lacks, and only under the Collect order.

### Orders

Hold **Q** for a radial menu picked with the mouse; tap Q to repeat the last order. Every order goes to the whole squadron: its players see it as a callout ("Sanne: Attack") and may follow or ignore it, and every companion in it follows. A companion summoned later joins the squadron's mode (#39, #42; this replaced ordering one companion under the cursor). There is no ammo or consumable in the game, so the "use it or save it" choices are about shields, health, big shots and enemy attention.

The orders are **five modes and three one-shots** (@starquake, 2026-09-28, #39). Separate switches for stance, fire, resources and targets could contradict each other, for example Aggressive with Hold fire. A mode is one coherent set, and a one-shot runs until done, then the wing returns to its mode.

| Mode | The wing |
|---|---|
| **Escort** (default) | flies formation on you and shoots anything near you |
| **Attack** | hunts enemies around you (within a leash), the weakest first, Support Ships first, big shots at will |
| **Guard** | stays tight, puts itself between you and whatever attacks the wing, answers attackers only, and falls back when hurt |
| **Hold here** | stays at the point under the cursor and shoots what comes in range |
| **Stealth** | follows you and never fires: sneak past a patrol, don't wake a boss |

| One-shot | The wing |
|---|---|
| **Focus** | all attacks the enemy you point at, or else the one you last hit |
| **Regroup** | disengages and comes back to formation now |
| **Go home** | flies back to the home planet |

With health (milestone 4), a **Support** mode fits in: stay close, revive downed friends, shield whoever is hit. Collect (milestone 5) becomes a mode or a one-shot then.

As built (#26, moved to Go in #50 and to the server in #51): the brain is `Think` in `internal/sim/brain.go`, a pure function from what a companion sees (its own ship, its owner, its formation slot, the enemies as drawn and whether each has attacked the wing, and the enemy bullets in flight) and its orders to a move, aim and fire command, plus whether a one-shot order is done. It is seeded, so every scenario is reproducible, and its distances live in `internal/sim/tuning.go`.

- **Moving:** it steers toward the velocity that closes on its goal and brakes on arrival, so it holds formation even with the owner at full speed.
- **Keeping apart** (#48): it nudges its goal away from its wingmates and other players' ships (and their companions) closer than 40 px, center to center, harder the closer they are, so companions sent to one place (a hold point, a focus target, home) spread out instead of bumping. Companions on one exact point leave it in different directions by formation slot. From its owner it keeps a firm 70 px (`BrainOwnerSpacing`, #68): no goal it flies to is closer, unless the owner is down and it comes to revive them. The formation slots sit about 90 and 128 px out, Guard's tighter formation 75% of that, and shielding 70 px out toward the attackers (@starquake, 2026-09-29: "I'm bumping against my companions and they put me down all the time, they should stay farther away").
- **Targets:** escorting and defending, enemies within 300 px of the owner; aggressive, within a 450 px leash, the weakest first. Defensive and return fire shoot only enemies that have attacked the wing.
- **Spreading out** (#165): companions don't all pick the best target. Each takes one of the best 3 that are as good on everything but distance and no more than 1.5× farther than the best, by a stable hash of its own key and the enemy's id. The key comes from its owner and its number, so a squadron spreads over a pack. The pick holds while the same enemies are there; a focus order and Support Ships first still decide before it.
- **Firing:** only within the weapon's reach and when facing within 0.2 rad of the target.
- **Dodging** (#249): the hub shows each companion the enemy bullets it flies. A companion notices a bullet within 250 px once the bullet has flown 0.25 s, and predicts it 1 s ahead in a straight line. When its own course would bring one within its shield or hull plus 6 px, it thrusts the way, of 8 around that course, that meets the fewest bullets, and those latest, preferring the ways nearest its course. Aim and fire don't change, so it fights on while it dodges. The Dreadnought's Ray, whose beam starts on top of a ship close to it, can't be dodged this way.
- **Falling back:** badly damaged, a defensive or conserving companion falls back into a tight formation. Until health exists (milestone 4), the damage state stands in for it.
- **Conserve:** the big space gun holds its volleys for Support Ships and focus targets.
- **Not yet built:** Revive and Collect come with milestones 4 and 5. Support Ship priority ranks targets, but has no effect until Support Ships exist.

As built (#27), single-player companions:

- **Seats:** G asks the server for a companion. The server grants the lowest free number up to 3, only at the home planet, to a player in a squadron with fewer than 4 ships, or refuses with a reason shown in the HUD. Development servers keep the same rules, so what's tested is what's played (@starquake, 2026-09-28; this reversed an earlier exception that lifted the limits there).
- **On the wire** (#51): the hub flies each companion with its brain, following its owner's latest state, as the seat `<playerId>/<n>`. Everyone, its owner included, gets it in snapshots as a player with an `owner_id`, drawn on the delayed timeline like any other ship. The hub fires its shots as remote shots under the seat, tests them against its own enemies and credits a kill to the seat. Orders go to the hub, which gives them to every companion in the squadron after each one's reaction time. A dismissed companion leaves like a player, and a reconnect keeps them.
- **The world counts them:** enemies target companions and spawn around them like players, and they count toward the 16 seats. A human joining a full world displaces the newest companion.
- **Looks:** Main Ship parts tinted in the owner's colour, labelled "name n"; the hub counts enemy bullets against them like any ship's, shield first (#46). Their shots sound like other players'.
- **Orders:** hold Q for a ring of the orders around the cursor, tap Q to repeat the last. The ring (#35) is a small circle on a dark disc: each order is its Void-pack icon with its label under it, modes in blue and one-shots in gold. The wing's mode is marked, the wing is named in the centre, and the pointed-at wedge is lit. The HUD's panel shows the wing's orders, and each notice shows as a toast. Hold here takes the point under the cursor. Focus takes the enemy under the cursor, else the one the player last hit (within 3 s), else the nearest within 120 px: small ships move too fast to point at (#39).
