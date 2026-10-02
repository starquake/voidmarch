package sim

import "math"

// Timing. The simulation runs at a fixed rate, independent of the display.
const (
	TickRate = 60
	// TickSeconds is typed, so it holds the same rounded value as the
	// client's 1 / 60, not Go's exact constant.
	TickSeconds float64 = 1.0 / TickRate
	// MaxTicksPerFrame caps catch-up after a stall (a background tab), so the
	// sim never spirals.
	MaxTicksPerFrame = 5
)

// The world is a hexagon of hexagonal sectors centered on the home planet at
// (0, 0): home and GridRings rings of sectors around it (#117).
const (
	// SectorRadius is a sector's center-to-corner distance: a flat-top
	// hexagon with about the area of the 1,600 px squares before it.
	SectorRadius = 990
	GridRings    = 3
	// WorldApothem is the world edge's center-to-side distance: a pointy-top
	// hexagon through the outer sectors' far corners.
	WorldApothem = SectorRadius * (threeHalves*GridRings + 1)
	// WorldEdgeBand is the band along the edge where a ship is pushed back.
	WorldEdgeBand = 200
	// WorldEdgePush is the push-back acceleration at the very edge, in px/s^2.
	WorldEdgePush = 1400
	// projectileMargin is how far projectiles may leave the world before they
	// are dropped.
	projectileMargin = 64
)

// Sizes and ranges in art pixels.
const (
	// SafeZoneRadius is the home planet's safe zone, where enemies never go
	// and companions are drawn from the hangar (the server's too).
	SafeZoneRadius = 300
	// BrainAttackerRange is how close an enemy that fires has attacked the
	// wing.
	BrainAttackerRange = 500
	// ShipRadius is the player ship's hit circle.
	ShipRadius = 12
	// ShotRadius is a projectile's own size when testing hits.
	ShotRadius = 3
	// EnemyAimJitter is how far, in radians, an enemy's aim wobbles from its
	// seed.
	EnemyAimJitter = 0.08
	// EnemyMuzzle is how far ahead of an enemy's center its bullets leave.
	EnemyMuzzle = 14
)

// Garrisons (#99): the Kla'ed holding each sector until it's cleared.
const (
	// GarrisonPlayerShare and GarrisonCompanionShare are how much of a
	// garrison's base size each ship that enters adds, counted once.
	GarrisonPlayerShare    = 0.5
	GarrisonCompanionShare = 0.25
	// StragglerSeconds is the least time between stragglers in a cleared
	// sector with someone in it.
	StragglerSeconds = 60
)

// GarrisonSize is a garrison's base size, for one player, by ring: heavier
// away from home. Home (ring 0) holds none.
func GarrisonSize(ring int) int {
	const ring1, perRing = 8, 4
	if ring <= 0 {
		return 0
	}

	return ring1 + perRing*(ring-1)
}

// GarrisonFighterShare is the share of a garrison that are Fighters, by ring.
func GarrisonFighterShare(ring int) float64 {
	const ring1, perRing, most = 0.375, 0.125, 0.75

	return math.Min(most, ring1+perRing*float64(max(ring-1, 0)))
}

// Derelicts and the fleet (#52).
const (
	// DerelictLifetime is the seconds a derelict waits to be rescued, once
	// freed.
	DerelictLifetime = 120
	// DerelictHoldRadius is how near an enemy holds a derelict (#114): it
	// can't be rescued, and its time doesn't run, until none is.
	DerelictHoldRadius = 600
	// MaxFleet caps the companion ships, docked or out: the server's seats.
	MaxFleet = 16
)

// The Frigate, an encounter boss (#89).
const (
	// FrigateBaseHP and FrigateHPPerPlayer make its health: the base plus a
	// share per player near it when the fight starts.
	FrigateBaseHP      = 40
	FrigateHPPerPlayer = 30
	// FrigateCompanionWeight is the share a companion counts for.
	FrigateCompanionWeight = 0.5
	// FrigateReach is how close a ship is to count as in the fight.
	FrigateReach = 800
	// FrigateRingBullets is how many bullets a ring has.
	FrigateRingBullets = 12
	// FrigateRingInterval is the seconds between rings.
	FrigateRingInterval = 3
	// FrigateMuzzle is how far from its center a ring's bullets leave.
	FrigateMuzzle = 24
	// FrigateShield is the damage the shield takes before it drops.
	FrigateShield = 20
	// FrigateShieldDelay is the seconds without a hit before the shield
	// recharges, all at once.
	FrigateShieldDelay = 8
	// FrigateRespawn is the seconds after it's destroyed before it's back.
	FrigateRespawn = 300
)

// Companion brains (docs/design.md, section 13).
const (
	// BrainArriveSeconds: a companion aims for the speed that would reach its
	// goal in this long, so it brakes on arrival.
	BrainArriveSeconds = 0.35
	// BrainTightFormation is the fraction of its size the defensive stance
	// pulls the formation in to.
	BrainTightFormation = 0.75
	// BrainInFormation: a companion this close to its slot is in formation.
	BrainInFormation = 16
	// BrainSpacing is how far, center to center, a companion keeps from other
	// friendly ships where it can: ships touch at 24 and bump (#48).
	BrainSpacing = 40
	// BrainOwnerSpacing is how far a companion keeps from its owner, farther
	// than from others: they fly together and brake together (#68).
	BrainOwnerSpacing = 70
	// BrainSplitTurn is the turn, in radians, between the ways companions on
	// one point leave it, by formation slot: the golden angle.
	BrainSplitTurn = 2.39996
	// BrainLookAhead is how far ahead along the owner's facing a companion
	// looks when nothing needs shooting.
	BrainLookAhead = 200
	// BrainEscortRange: escorting and defending companions shoot enemies this
	// close to their owner.
	BrainEscortRange = 300
	// BrainLeash: aggressive companions hunt enemies this close to their
	// owner, and no farther.
	BrainLeash = 450
	// BrainAttackDistance is how close a hunting companion gets to its target.
	BrainAttackDistance = 130
	// BrainFireCone: a companion fires only when facing within this many
	// radians of its target.
	BrainFireCone = 0.2
	// BrainAimJitter is how far, in radians, a companion's aim wobbles from
	// its seed.
	BrainAimJitter = 0.04
	// BrainBadlyDamaged: from this many hits on, defensive or conserving
	// companions fall back.
	BrainBadlyDamaged = 3
	// BrainHomeRadius: going home is done this close to the home planet,
	// inside the server's safe zone.
	BrainHomeRadius = 250
	// BrainShieldDistance: shielding the owner, a companion keeps this far out
	// toward the attackers.
	BrainShieldDistance = BrainOwnerSpacing
	// BrainReactionMin and BrainReactionMax bound how late, in seconds, each
	// companion reacts, picked per companion from its seed, so a wing doesn't
	// move in lockstep.
	BrainReactionMin float64 = 0.15
	BrainReactionMax float64 = 0.5
	// BrainOrderJitter is how much longer, at most, an order waits, fresh for
	// every order.
	BrainOrderJitter = 0.25
)

// Damage and recovery (docs/design.md, section 4; #46).
const (
	// MaxDamage is the hits a hull takes: very damaged, and down once #47
	// lands.
	MaxDamage = 3
	// ShieldRechargeDelay is the seconds without a hit before a shield
	// recharges.
	ShieldRechargeDelay float64 = 3
	// HullRegenDelay is the seconds without a hit before the hull heals.
	HullRegenDelay float64 = 8
	// HullRegenEvery is the seconds per hull step healed, after the delay.
	HullRegenEvery float64 = 10
	// FormationRadius is how close a squadmate must be for the formation
	// bonus: shields recharge FormationRecharge times as fast.
	FormationRadius   = 200
	FormationRecharge = 2
	// NoSquadmate is the squadmate distance when there's none near.
	NoSquadmate = math.MaxFloat64
)

// Going down (#47): a ship out of hull drifts until a friend revives it or
// its player respawns.
const (
	// ReviveRadius is how close, center to center, a friendly ship must stay
	// to revive a downed one: about a ship and a half between hulls (#66),
	// and past BrainSpacing, so a companion keeping its distance reaches.
	ReviveRadius = 100
	// ReviveSeconds is how long a friend nearby takes to revive a downed
	// ship, and how long its progress takes to drain with nobody near; a
	// squadmate takes ReviveSquadmateSeconds.
	ReviveSeconds          float64 = 5
	ReviveSquadmateSeconds float64 = 3
	// RespawnDelay is the seconds after going down before its player may
	// respawn.
	RespawnDelay float64 = 3
	// CompanionLostSeconds: a companion down this long unrevived goes home
	// to the hangar.
	CompanionLostSeconds float64 = 60
	// BrainReviveRange: a companion goes to revive a downed squadmate this
	// close to it.
	BrainReviveRange = 400
	// HomeSpawnY is where a ship starts and respawns, below the home planet.
	HomeSpawnY = 160
)

// Bumping (#48): ships and enemies push apart, and a fast collision hurts.
const (
	// RammingSpeed is the closing speed, in px/s, from which a collision is a ram.
	RammingSpeed float64 = 120
	// RammingReach is how close, in px past touching, bodies count as meeting
	// for a ram.
	RammingReach float64 = 8
	// RammingCooldown is the seconds before the same two bodies can ram again.
	RammingCooldown float64 = 1
	// RammingDamage is what a ram does to an enemy, like a zapper hit.
	RammingDamage = 2
)

// EngineStats is how an engine flies.
type EngineStats struct {
	// Acceleration is in px/s^2 while thrusting.
	Acceleration float64
	// MaxSpeed is in px/s.
	MaxSpeed float64
	// Drag is the fraction of velocity lost per second, applied continuously.
	Drag float64
}

// EngineStatsOf is an engine's stats. Sidegrades: snappy and slow, drifty and
// fast, and between.
func EngineStatsOf(id EngineID) EngineStats {
	switch id {
	case EngineBigPulse:
		return EngineStats{Acceleration: 520, MaxSpeed: 300, Drag: 1.2}
	case EngineBurst:
		return EngineStats{Acceleration: 1700, MaxSpeed: 185, Drag: 7}
	case EngineSupercharged:
		return EngineStats{Acceleration: 1200, MaxSpeed: 270, Drag: 2}
	case EngineBase:
		fallthrough
	default:
		return EngineStats{Acceleration: 900, MaxSpeed: 220, Drag: 3.5}
	}
}

// Offset is a position relative to a ship in art pixels: forward along its
// facing, and to its right.
type Offset struct {
	Forward float64
	Right   float64
}

// Zigzag is the sideways travel of a zigzagging projectile; amplitude 0 flies
// straight.
type Zigzag struct {
	Amplitude float64
	Frequency float64
}

// ProjectileStats is how a projectile flies: shared by player weapons and
// enemy bullets.
type ProjectileStats struct {
	// Speed is the launch speed in px/s.
	Speed float64
	// Acceleration is in px/s^2, 0 for constant speed.
	Acceleration float64
	// MaxSpeed caps the speed when accelerating.
	MaxSpeed float64
	// Lifetime is the seconds before the projectile expires.
	Lifetime float64
	Zigzag   Zigzag
}

// WeaponStats is how a weapon fires, and how its shots fly.
type WeaponStats struct {
	ProjectileStats

	// Interval is the seconds between shots.
	Interval float64
	// Charge is the seconds between pulling the trigger and the shot leaving;
	// a started charge always fires.
	Charge float64
	Damage float64
	// Muzzles are the barrels in sprite pixels from the ship's center.
	Muzzles []Offset
	// Alternate fires one muzzle per shot in turn instead of all at once.
	Alternate bool
	// Shake is the camera shake when one of our own shots bursts, 0 for none.
	Shake float64
	// Seek steers its shots toward enemies (#72); zero for straight shots.
	Seek Seek
	// Pierce is how many enemies a shot carries on through after its first.
	Pierce int
	// Burst is the star of shards a shot scatters where it ends.
	Burst Burst
}

// Seek is how a shot steers toward the nearest enemy ahead of it.
type Seek struct {
	// Cone is the half-angle, in radians, around its heading it looks in.
	Cone float64
	// Range is how far, in px, it looks.
	Range float64
	// TurnRate is how fast it turns, in radians per second.
	TurnRate float64
}

// Burst is a star of shards: how many, and each one's damage.
type Burst struct {
	Shards int
	Damage float64
}

// ShardStats is how a burst's shard flies: 260 px/s for 0.46 s, about 120 px.
func ShardStats() ProjectileStats {
	return ProjectileStats{Speed: 260, MaxSpeed: 260, Lifetime: 0.46}
}

// WeaponStatsOf is a weapon's stats. Sidegrades: a new player's auto cannon
// is useful in any fight.
func WeaponStatsOf(id WeaponID) WeaponStats {
	switch id {
	case WeaponRockets:
		return WeaponStats{
			Speed: 140, Acceleration: 900, MaxSpeed: 560, Lifetime: 1.5,
			// Seeking pays for itself: about 7.5 damage a second, under the
			// auto cannon's (#72).
			Interval:  0.4,
			Damage:    3,
			Seek:      Seek{Cone: math.Pi / 3, Range: 400, TurnRate: 3},
			Muzzles:   []Offset{{Forward: 7, Right: -12}, {Forward: 7, Right: 12}},
			Alternate: true,
		}
	case WeaponBigSpaceGun:
		return WeaponStats{
			Speed: 300, MaxSpeed: 300, Lifetime: 0.5,
			Interval: 0.9,
			Charge:   0.45,
			Damage:   12,
			Muzzles:  []Offset{{Forward: 16}},
			Shake:    0.002,
			Burst:    Burst{Shards: 8, Damage: 2},
		}
	case WeaponZapper:
		return WeaponStats{
			Speed: 430, MaxSpeed: 430, Lifetime: 0.75,
			Zigzag:   Zigzag{Amplitude: 7, Frequency: 5},
			Interval: 0.24,
			Charge:   0.1,
			Damage:   2,
			Muzzles:  []Offset{{Forward: 15, Right: -11}, {Forward: 15, Right: 11}},
			Pierce:   2,
		}
	case WeaponAutoCannon:
		fallthrough
	default:
		return WeaponStats{
			Speed: 520, MaxSpeed: 520, Lifetime: 0.9,
			Interval:  0.13,
			Damage:    1,
			Muzzles:   []Offset{{Forward: 9, Right: -10.5}, {Forward: 9, Right: 10.5}},
			Alternate: true,
		}
	}
}

// EnemyBulletStatsOf is how an enemy bullet flies: slow and readable, so it
// can be dodged (docs/design.md, section 3).
func EnemyBulletStatsOf(id EnemyBulletID) ProjectileStats {
	if id == KlaedBigBullet {
		return ProjectileStats{Speed: 130, MaxSpeed: 130, Lifetime: 3}
	}

	return ProjectileStats{Speed: 110, MaxSpeed: 110, Lifetime: 3.2}
}

// ShieldStats is a shield's coverage against strength against recharge; used
// from milestone 4 (#5).
type ShieldStats struct {
	// Coverage is the arc the shield blocks, centered on the aim, in radians.
	Coverage float64
	// Strength is the hits absorbed before it drops.
	Strength float64
	// Recharge is the seconds out of combat to recharge fully.
	Recharge float64
	// Radius is where the shield is drawn, from the sprite's opaque extent:
	// bullets meet it there, before the hull.
	Radius float64
}

// Covers reports whether a hit from offset radians off the aim is inside the arc.
func (s ShieldStats) Covers(offset float64) bool {
	return math.Abs(WrapAngle(offset)) <= s.Coverage/2
}

// ShieldStatsOf is a shield's stats.
func ShieldStatsOf(id ShieldID) ShieldStats {
	switch id {
	case ShieldFrontAndSide:
		return ShieldStats{Coverage: math.Pi, Strength: 2, Recharge: 5, Radius: 23}
	case ShieldRound:
		return ShieldStats{Coverage: Tau, Strength: 1, Recharge: 3, Radius: 25}
	case ShieldInvincibility:
		return ShieldStats{Coverage: Tau, Strength: 3, Recharge: 12, Radius: 14}
	case ShieldFront:
		fallthrough
	default:
		return ShieldStats{Coverage: math.Pi * half, Strength: 3, Recharge: 5, Radius: 21}
	}
}

// FormationSlots are the companion slots behind and beside the owner,
// turning with the owner's facing.
func FormationSlots() []Offset {
	return []Offset{
		{Forward: -68, Right: -60},
		{Forward: -68, Right: 60},
		{Forward: -128},
	}
}

// Progression (#6, #77).
const (
	// TierBoost is how much more of its own strength each tier gives a part:
	// fire rate, acceleration or recharge, so Hyper is about 1.45 times plain.
	TierBoost = 0.15
	// ScoutDropChance and FighterDropChance are the chances a kill drops a
	// part; catch-up doubles them.
	ScoutDropChance   = 0.1
	FighterDropChance = 0.3
	FrigateDropChance = 1
	CatchUpDrops      = 2
	// DropReach is how close to a kill a player counts as nearby: the part
	// favors what they lack, and a player behind their squadron makes drops
	// likelier.
	DropReach = 800
	// PickupLifetime is how long a pickup waits to be collected, in seconds.
	PickupLifetime = 30
	// PickupReach is how close a ship's center comes to collect a pickup.
	PickupReach = 24
)
