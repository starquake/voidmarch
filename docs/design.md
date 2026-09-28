# Voidmarch — Game Design Document

> A drop-in/drop-out, persistent-world, co-op twin-stick space shooter for a group of friends (1–16 players), playable in the browser with no install.
>
> *About the name: a "march" is an old word for a borderland, literally a frontier. Voidmarch is the frontier of the void, pushed outward together.*

## 1. Vision

- **Web only, no install.** Open a URL, pick a name, play.
- **Drop in / drop out.** The world is persistent and keeps existing when nobody is online. Some evenings 1 player is on, sometimes 3, on a busy evening 16.
- **Nobody feels behind.** Progress is mostly *shared* (the frontier). Personal progress is *horizontal* (more options, not more power).
- **Shared goal:** push the frontier outward by defeating each alien faction's Dreadnought. Defeat all three and the season ends.
- **Personal goals:** collect all 12 ship parts and experiment with loadouts.
- **Players are friends.** Griefing and cheating are not design concerns. This lets us trust the client (see §9).

## 2. Hard constraint: art

**Only use mechanics and items that exist in Foozle's "Void" asset packs** (CC0, <https://foozlecc.itch.io/>). Recoloring and tinting existing sprites **is allowed**.

| Pack | Contents | Use |
|---|---|---|
| Void – Main Ship | Player ship base sprite in 4 damage states, 4 engines, 4 shields, 4 weapons (with projectiles), all animated | Player ships |
| Void – Pickups Pack | 12 animated pickups (expected: icons for the 4 weapons, 4 engines, 4 shields; **verify after download**) | Part drops / unlocks |
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

### Loadout (horizontal progression)

Three slots, four options each = 64 loadouts:

| Slot | Options (from Main Ship pack) | Gameplay role (tunable) |
|---|---|---|
| Weapon | Auto cannon, Rockets, Big space gun, Zapper (zigzag beam) | Different fire rate / damage / pattern |
| Engine | 4 engine variants | Speed / acceleration / handling trade-offs |
| Shield | 4 shield variants (incl. front, front+sides, round bubble) | Coverage vs strength trade-offs |

- Every new player starts with **one default part per slot**.
- **Parts are permanent unlocks.** Enemies drop part pickups. Collecting a pickup for a part you don't own unlocks it forever for your player.
- Loadout can be changed **at the home planet**.
- Weapon/engine/shield *choices* should be sidegrades, never strictly better. A new player with defaults is useful in any fight.

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

## 5. Going down (death without setbacks)

- At 0 health the ship is **downed**: it stays as the "very damaged" sprite, drifting slowly, unable to shoot.
- **Revive:** a teammate hovering near the downed ship for N seconds (tunable, ~3s) revives it at 1 health step.
- **Respawn:** a downed player can choose to respawn at the home planet, or next to a living friend, after a short delay.
- **Nothing is lost.** No currency, no parts, no tier. The only cost is time.

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
- **Enemies** (milestone 3, #4): the server runs them at the tick rate and sends their positions in each snapshot; clients draw them on the same 100 ms delayed timeline. A shot is one `EnemyFired` message (enemy, tick, seed, angle), announced 6 ticks ahead: clients animate the weapon from then, and at the tick expand the seed into bullets from the enemy's position in that tick's snapshot, with the same seeded pattern (`frontend/src/sim/patterns.ts`). Clients skip volleys from enemies more than 800 px away, which they could neither see nor be hit by. A client that sees its own shot touch an enemy sends a `Hit` (damage capped at 12); the server applies it, tells the others the shot ended (`ShotEnded`), and announces `EnemyDestroyed` when the HP runs out. Both carry the tick of the hit, so the others see them on the same delayed timeline as the shot and the enemy. Each client checks enemy bullets against its own ship.
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

- Exact contents of the Pickups Pack (verify the 12 pickups map to the 12 parts).
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
- **Targets:** escorting and defending, enemies within 300 px of the owner; aggressive, within a 450 px leash, the weakest first. Defensive and return fire shoot only enemies that have attacked the wing.
- **Firing:** only within the weapon's reach and when facing within 0.2 rad of the target.
- **Falling back:** badly damaged, a defensive or conserving companion falls back into a tight formation. Until health exists (milestone 4), the damage state stands in for it.
- **Conserve:** the big space gun holds its volleys for Support Ships and focus targets.
- **Not yet built:** Revive and Collect come with milestones 4 and 5. Support Ship priority ranks targets, but has no effect until Support Ships exist.

As built (#27), single-player companions:

- **Seats:** G asks the server for a companion. The server grants the lowest free number up to 3, only at the home planet, to a player in a squadron with fewer than 4 ships, or refuses with a reason shown in the HUD. Development servers keep the same rules, so what's tested is what's played (@starquake, 2026-09-28; this reversed an earlier exception that lifted the limits there).
- **On the wire** (#51): the hub flies each companion with its brain, following its owner's latest state, as the seat `<playerId>/<n>`. Everyone, its owner included, gets it in snapshots as a player with an `owner_id`, drawn on the delayed timeline like any other ship. The hub fires its shots as remote shots under the seat, tests them against its own enemies and credits a kill to the seat. Orders go to the hub, which gives them to every companion in the squadron after each one's reaction time. A dismissed companion leaves like a player, and a reconnect keeps them.
- **The world counts them:** enemies target companions and spawn around them like players, and they count toward the 16 seats. A human joining a full world displaces the newest companion.
- **Looks:** Main Ship parts tinted in the owner's colour, labelled "name n"; enemy bullets flash them. Their shots sound like other players'.
- **Orders:** hold Q for a ring of the orders around the cursor, tap Q to repeat the last. The ring (#35) is a small circle on a dark disc: each order is its Void-pack icon with its label under it, modes in blue and one-shots in gold. The wing's mode is marked, the wing is named in the centre, and the pointed-at wedge is lit. The HUD shows the wing's mode, with the latest notice on its own line. Hold here takes the point under the cursor. Focus takes the enemy under the cursor, else the one the player last hit (within 3 s), else the nearest within 120 px: small ships move too fast to point at (#39).
