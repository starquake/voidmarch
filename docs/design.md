# Voidmarch — Game Design Document

> A drop-in/drop-out, persistent-world, co-op twin-stick space shooter for a group of friends (1–16 players), playable in the browser with no install.
>
> *About the name: a "march" is an old word for a borderland, literally a frontier. Voidmarch is the frontier of the void, pushed outward together.*

## 1. Vision

- **Web only, no install.** Open a URL, pick a name, play.
- **Drop in / drop out.** The world is persistent and keeps existing when nobody is online. Some evenings 1 player is on, sometimes 3, on a busy evening 16.
- **Nobody feels behind.** Progress is mostly *shared* (the frontier). Personal progress is mostly *horizontal* (more options), with a modest, capped step up through part tiers (§4).
- **Shared goal:** push the frontier outward by defeating each alien faction's Dreadnought. Defeat all three and the season ends.
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

**Things intentionally NOT in the game (no art for them):** currency/scrap, space stations, outposts, base building, player ship explosion.

**Future (allowed via reuse/recolor):** asteroid mining (Environment asteroid), escort missions (enemy ships recolored as friendly convoys).

## 3. Controls & feel

- **Twin-stick:** WASD to move, mouse to aim, hold left mouse button to fire.
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
| Big space gun | **Bursts** where the ball hits or after 200 px, into a star of 8 shards (the auto cannon's shot, recolored gold), seeded by the shot, so every screen draws the same star | 12 for the ball, then 2 per shard, 90 px out; the shards fly past the enemy the ball hit, so the burst is crowd damage, not a bigger single hit |
| Zapper | **Pierces**: the zigzag beam carries on through 2 more enemies after the first | 2 per enemy, 3 at most |

Tiers (below) raise each weapon's fire rate; the advantages stay as they are. Rockets that others fire are steered on each screen toward the enemies as it draws them, so a curve can differ a little between screens; only the shooter reports hits.

- Every new player starts with **one default part per slot**.
- **Parts are permanent unlocks.** Enemies drop part pickups. Collecting a pickup for a part you don't own unlocks it forever for your player.
- Loadout can be changed **at the home planet**.
- Weapon/engine/shield *choices* should be sidegrades, never strictly better. A new player with defaults is useful in any fight.

### Tiers (getting stronger)

Decided in #6 (@starquake, 2026-09-29: "Should we consider upgrades. Doesn't it feel boring if you can't become stronger?"):

- **A part grows through three tiers: Super, Mega and Hyper.** A part starts plain ("Auto Cannon"). Picking up a part you already own upgrades it one tier: Super Auto Cannon, Mega Auto Cannon, then Hyper Auto Cannon, the cap.
- **Each tier adds about 15%** to that part's own strength: a weapon's fire rate, a shield's recharge, an engine's acceleration (tunable; @starquake picked 15 over 10: "Is the +10% enough? Shouldn't it be more?"). A Hyper part is about 1.45× a plain one, so each tier is felt in a fight. A veteran is stronger than a newcomer but never in a different league, and a newcomer with plain parts still pulls their weight.
- **The parts stay sidegrades of each other**: a Hyper Zapper and a Hyper Rocket are equals, and so are two plain ones. Tiers reward playing, not a best loadout.
- **Each tier has its own color**, which tints the part sprite, outlines its pickup and colors the name in the HUD and on the player's label (@starquake: "We could use colors and show super mega and hyper in front of the name"). The packs have one sprite per part and no tier art, so tier colors are recolors, which the art rule allows. The colors come in a mockup.
- Still open in #6: how later joiners catch up (catch-up drops while below their squadmates, or a rising floor), and what happens to a pickup of a part you already have at Hyper.

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
- A player and their own companions only push each other, never ram (#68): no shield charge or hull step on either side. Rams with any other ship, squadmates' companions included, and with enemies still hurt.
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
- **Respawn:** 3 s after going down, the downed player gets a panel: **H** respawns at home, **J** beside the nearest squadmate that is up, both with a whole hull and a full shield. Waiting for a revive stays possible.
- **Companions** fly to a downed squadmate within 400 px, their owner included, and hover 40 px beside it until it's up, in every mode but Hold and Stealth. A downed companion is revived the same way (its owner counts as a squadmate); after 30 s down it goes home to the hangar, and its owner is told.

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

As built in milestone 3 (#4), Kla'ed fodder only:

- **Spawning**: the server keeps enemies around each player outside the safe zone (300 px around the home planet): 2 for every ship within 500 px, never fewer than 3, so a solo player meets 3, a pair 4 and a wing of 4 about 8 (#25). Companions will count as ships. It spawns one a second just out of view (380–460 px away); 40% are Fighters. An enemy with no player outside the safe zone within 800 px for 30 s leaves. Enemies are pushed out of the safe zone.
- **Scout**: 2 HP, fast (150 px/s), wanders erratically and closes to about 90 px; fires one small bullet.
- **Fighter**: 6 HP, slower (95 px/s), strafes around its target at about 170 px; fires one big bullet.
- **Firing**: enemies come for the nearest player within 500 px, the whole spawn ring, and fire once within 340 px, where their bullets still reach, every so many ticks with jitter; every volley is telegraphed by the weapon animating for 300 ms before the bullets leave; bullets are slow enough to dodge (110–130 px/s), aimed with a small seeded spread. Enemy shots have their own soft laser (Kenney `laserSmall_004`).
- **Enemy fire stands out** (#36): the Kla'ed bullets are drawn in a blue recolour of the pack's orange ones (`tools/recolor.py`, a palette swap), and they fly on a layer with one blue glow. Players' shots stay orange. The glow follows the F effects toggle.
- **Death**: the pack's destruction animation, and an explosion sound when it happens in view. No drops yet (pickups are milestone 5).

## 7. Bosses and scaling for 1–16 players

### Encounter bosses (Frigate, Battlecruiser)

- Normal fights, a few minutes long.
- **Health scales with the number of players nearby** when the fight starts (and optionally as players join).
- Reset if everyone leaves or goes down.

### Siege bosses (Dreadnought)

- One per faction, guarding the path to the next ring.
- **Persistent health** stored on the server. It does not reset when players log off.
- A solo player on a lunch break can chip off a few percent. A busy evening finishes it.
- **Slow regeneration** (tunable) so it's not purely a grind, and concentrated group effort matters.
- Defeating it **unlocks the next ring permanently** for everyone.

## 8. World structure: the frontier

- Large 2D map, camera follows the player, parallax backgrounds from the Environment pack.
- **Home planet** at the center (Environment planet). Spawn point, loadout changes, safe zone.
- **Three rings** around it:
  1. Kla'ed space
  2. Nairan space
  3. Nautolan space
- Each ring gets its own **tinted background** so it feels distinct (recoloring allowed).
- Ring N+1 is inaccessible until ring N's Dreadnought is destroyed (barrier/boundary; no special art needed — e.g. a hard edge or tinted zone).
- Asteroids (Environment pack) as obstacles/cover.

### Season

- When all three Dreadnoughts are destroyed, the season ends.
- New season: reset frontier and boss health, optionally reshuffle the ring order or layout. **Keep personal part unlocks** (or reset them — decide later).

## 9. Technical architecture

### Overview

- **Server:** Go. Authoritative for the world state: enemies, bosses, frontier, player unlocks, persistence.
- **Client:** browser, HTML5 canvas, served by the Go server. Keep it simple (plain JS or TypeScript, no heavy framework needed).
- **Transport:** WebSockets.
- **Persistence:** a database for persistent state (frontier progress, Dreadnought health, player unlocks). SQLite is a good fit.

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
- Only send entities near each player (interest management by distance/area) if bandwidth becomes an issue.

As built in milestone 2 (#3):

- **Protocol**: WebSocket at `/ws`, Protocol Buffers (`proto/voidmarch/v1/messages.proto`) in binary frames, or protobuf JSON in text frames per connection for debugging.
- **Ships**: each client sends its ship's state 20 times a second; the server keeps the latest and sends everyone a snapshot of the others every tick. Clients draw other ships 100 ms in the past, blended between snapshots.
- **Shots**: a shot is one message; the server stamps it with its tick and relays it; every client simulates the projectile from that spawn (position is a pure function of spawn and age), on the same delayed timeline as the ships.
- **Enemies** (milestone 3, #4): the server runs them at the tick rate and sends their positions in each snapshot; clients draw them on the same 100 ms delayed timeline. A shot is one `EnemyFired` message (enemy, tick, seed, angle), announced 6 ticks ahead: clients animate the weapon from then, and at the tick expand the seed into bullets from the enemy's position in that tick's snapshot, with the same seeded pattern (`frontend/src/sim/patterns.ts`). Clients skip volleys from enemies more than 800 px away, which they could neither see nor be hit by. A client that sees its own shot touch an enemy sends a `Hit` (damage capped at 12); the server applies it, tells the others the shot ended (`ShotEnded`), and announces `EnemyDestroyed` when the HP runs out. Both carry the tick of the hit, so the others see them on the same delayed timeline as the shot and the enemy. Each client checks enemy bullets against its own ship; since #46 the hub also fires each volley with a companion within 800 px of the enemy, from the enemy's position at the volley's tick, and checks it against the companions.
- **Players**: name and token in memory until persistence arrives with unlocks; a client whose token the server forgot is asked for a name again. At most 16 players; a player silent for 10 s is removed (a hidden tab keeps sending, #57); a client too slow to keep up is dropped rather than slowing the others.

### Persistent state (at minimum)

- Players: id, name, token, unlocked parts, current loadout.
- Frontier: which rings are unlocked, current season.
- Dreadnoughts: current health per faction, last update time (for regeneration).

Enemies roaming the world do not need to be persisted; respawn them on server start.

### Identity

- Friends only: a player picks a name on first visit, the server issues a token stored in the browser. No passwords.

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
5. **Pickups and loadouts:** part drops, permanent unlocks, loadout change at the home planet, persistence.
6. **Encounter boss:** Kla'ed Frigate with player-count scaling.
7. **Siege boss:** Kla'ed Dreadnought with persistent health and regeneration; unlock ring 2.
8. **Rings 2 and 3:** Nairan and Nautolan factions, tinted backgrounds.
9. **Season end and reset.**
10. **Later:** asteroid mining, escort missions.

Sound and music arrived with the sandbox (#14), ahead of the milestones: Kenney's Sci-Fi Sounds for effects, Foozle's Explorer Chiptunes for music, with Eerie Space Music set aside for the home planet and the Dreadnought fights.

## 12. Open questions

- Stats for each weapon, engine and shield.
- Do personal unlocks reset at season end?
- Dreadnought health and regeneration numbers for a 1–16 player group.
- Map size and how rings are separated.
- ~~Sound and music~~: decided in #14 (Kenney Sci-Fi Sounds, Foozle Explorer Chiptunes and Eerie Space Music, all CC0).

## 13. Companions

Companions are AI-flown wingmates. They make playing alone, or with one friend, feel like playing with the group, and real players replace them as they come online.

- **A companion is a player seat driven by an AI brain instead of a keyboard.** The brain produces the same move, aim and fire command as the keyboard and mouse. The ship is an ordinary player ship: same physics, weapons, shields, health, going down and revive. The server flies every companion (#51), so a companion keeps flying whoever is online, and on the wire they are players with an owner.
- **Where from** (#49): one hangar pool for the whole server holds the companion ships waiting at home. G at the home planet draws one, first come, first served; a companion that goes home, or whose player drops, docks back into it. Players and companions come from different pools: a joiner who takes a companion's place (a takeover, or displacing one from a full world) holds that ship until they leave, so joining and leaving never add companions. The pool starts at `POOL_START` ships (3 until fights can be won and add ships, #52), lives in memory and resets on a restart until part unlocks bring a store (#6).
- **How many:** up to 3 per player, and at most 4 ships per squadron, companions included (#42 replaced the earlier "wing within one screen" cap). Companions are full seats: they count toward the 16-player cap, and a human joining a full world takes one over or displaces one, so the group, and its difficulty, stays the same whoever flies each ship.
- **Summoning** happens at the home planet, alongside the loadout change. The owner picks each companion's loadout from their own unlocked parts. Until the loadout change exists (milestone 5), G summons one inside the safe zone.
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

As built (#26, moved to Go in #50 and to the server in #51): the brain is `Think` in `internal/sim/brain.go`, a pure function from what a companion sees (its own ship, its owner, its formation slot, the enemies as drawn and whether each has attacked the wing) and its orders to a move, aim and fire command, plus whether a one-shot order is done. It is seeded, so every scenario is reproducible, and its distances live in `internal/sim/tuning.go`.

- **Moving:** it steers toward the velocity that closes on its goal and brakes on arrival, so it holds formation even with the owner at full speed.
- **Keeping apart** (#48): it nudges its goal away from its wingmates and other players' ships (and their companions) closer than 40 px, center to center, harder the closer they are, so companions sent to one place (a hold point, a focus target, home) spread out instead of bumping. Companions on one exact point leave it in different directions by formation slot. From its owner it keeps a firm 70 px (`BrainOwnerSpacing`, #68): no goal it flies to is closer, unless the owner is down and it comes to revive them. The formation slots sit about 90 and 128 px out, Guard's tighter formation 75% of that, and shielding 70 px out toward the attackers (@starquake, 2026-09-29: "I'm bumping against my companions and they put me down all the time, they should stay farther away").
- **Targets:** escorting and defending, enemies within 300 px of the owner; aggressive, within a 450 px leash, the weakest first. Defensive and return fire shoot only enemies that have attacked the wing.
- **Firing:** only within the weapon's reach and when facing within 0.2 rad of the target.
- **Falling back:** badly damaged, a defensive or conserving companion falls back into a tight formation. Until health exists (milestone 4), the damage state stands in for it.
- **Conserve:** the big space gun holds its volleys for Support Ships and focus targets.
- **Not yet built:** Revive and Collect come with milestones 4 and 5. Support Ship priority ranks targets, but has no effect until Support Ships exist.

As built (#27), single-player companions:

- **Seats:** G asks the server for a companion. The server grants the lowest free number up to 3, only at the home planet, to a player in a squadron with fewer than 4 ships, or refuses with a reason shown in the HUD. Development servers keep the same rules, so what's tested is what's played (@starquake, 2026-09-28; this reversed an earlier exception that lifted the limits there).
- **On the wire** (#51): the hub flies each companion with its brain, following its owner's latest state, as the seat `<playerId>/<n>`. Everyone, its owner included, gets it in snapshots as a player with an `owner_id`, drawn on the delayed timeline like any other ship. The hub fires its shots as remote shots under the seat, tests them against its own enemies and credits a kill to the seat. Orders go to the hub, which gives them to every companion in the squadron after each one's reaction time. A dismissed companion leaves like a player, and a reconnect keeps them.
- **The world counts them:** enemies target companions and spawn around them like players, and they count toward the 16 seats. A human joining a full world displaces the newest companion.
- **Looks:** Main Ship parts tinted in the owner's colour, labelled "name n"; the hub counts enemy bullets against them like any ship's, shield first (#46). Their shots sound like other players'.
- **Orders:** hold Q for a ring of the orders around the cursor, tap Q to repeat the last. The ring (#35) is a small circle on a dark disc: each order is its Void-pack icon with its label under it, modes in blue and one-shots in gold. The wing's mode is marked, the wing is named in the centre, and the pointed-at wedge is lit. The HUD shows the wing's mode, with the latest notice on its own line. Hold here takes the point under the cursor. Focus takes the enemy under the cursor, else the one the player last hit (within 3 s), else the nearest within 120 px: small ships move too fast to point at (#39).
