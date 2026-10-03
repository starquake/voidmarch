package sim

import "math"

// EnemyKind is an enemy class, matching the protocol's EnemyKind.
type EnemyKind string

// The enemy classes.
const (
	EnemyScout   EnemyKind = "scout"
	EnemyFighter EnemyKind = "fighter"
	EnemyFrigate EnemyKind = "frigate"
	// EnemyDreadnought is the siege boss (#8).
	EnemyDreadnought EnemyKind = "dreadnought"
	// EnemyBomber and EnemyTorpedo, the Torpedo Ship, are the later
	// factions' slow heavy hitters (#137).
	EnemyBomber  EnemyKind = "bomber"
	EnemyTorpedo EnemyKind = "torpedo"
)

// EnemyFaction is the alien fleet an enemy belongs to, one per ring (#9):
// the class says how it fights, the faction how hard.
type EnemyFaction string

// The factions, matching the protocol's EnemyFaction.
const (
	Klaed    EnemyFaction = "klaed"
	Nairan   EnemyFaction = "nairan"
	Nautolan EnemyFaction = "nautolan"
)

// EnemyFactions lists every faction, from home outward.
func EnemyFactions() []EnemyFaction {
	return []EnemyFaction{Klaed, Nairan, Nautolan}
}

// FactionOfRing is the faction holding ring: the Kla'ed in ring 1, the
// Nairan in ring 2 and the Nautolan in ring 3 (#9).
func FactionOfRing(ring int) EnemyFaction {
	const nairanRing, nautolanRing = 2, 3
	switch ring {
	case nairanRing:
		return Nairan
	case nautolanRing:
		return Nautolan
	default:
		return Klaed
	}
}

// EnemyBulletID names an enemy bullet from the fleet packs' projectiles.
type EnemyBulletID string

// The enemy bullets.
const (
	KlaedBullet    EnemyBulletID = "klaedBullet"
	KlaedBigBullet EnemyBulletID = "klaedBigBullet"
	// KlaedRay and KlaedWave are the Dreadnought's (#124).
	KlaedRay  EnemyBulletID = "klaedRay"
	KlaedWave EnemyBulletID = "klaedWave"
	// NairanBolt, NairanRay, NautolanBullet and NautolanSpinningBullet are
	// the Nairan and Nautolan Scouts' and Fighters' (#136).
	NairanBolt             EnemyBulletID = "nairanBolt"
	NairanRay              EnemyBulletID = "nairanRay"
	NautolanBullet         EnemyBulletID = "nautolanBullet"
	NautolanSpinningBullet EnemyBulletID = "nautolanSpinningBullet"
	// NairanRocket and NautolanBomb are the Bombers', NairanTorpedo and
	// NautolanWave the Torpedo Ships' (#137).
	NairanRocket  EnemyBulletID = "nairanRocket"
	NairanTorpedo EnemyBulletID = "nairanTorpedo"
	NautolanBomb  EnemyBulletID = "nautolanBomb"
	NautolanWave  EnemyBulletID = "nautolanWave"
)

// EnemyKinds lists every enemy class.
func EnemyKinds() []EnemyKind {
	return []EnemyKind{
		EnemyScout, EnemyFighter, EnemyFrigate, EnemyDreadnought, EnemyBomber, EnemyTorpedo,
	}
}

// EnemyBullet is each enemy's bullet: its faction's small one for a Scout,
// its big one for the rest.
func EnemyBullet(kind EnemyKind, faction EnemyFaction) EnemyBulletID {
	scout := kind == EnemyScout
	switch {
	case kind == EnemyBomber && faction == Nautolan:
		return NautolanBomb
	case kind == EnemyBomber:
		return NairanRocket
	case kind == EnemyTorpedo && faction == Nautolan:
		return NautolanWave
	case kind == EnemyTorpedo:
		return NairanTorpedo
	case faction == Nairan && scout:
		return NairanBolt
	case faction == Nairan:
		return NairanRay
	case faction == Nautolan && scout:
		return NautolanBullet
	case faction == Nautolan:
		return NautolanSpinningBullet
	case scout:
		return KlaedBullet
	default:
		return KlaedBigBullet
	}
}

// EnemyRadius is an enemy's hit circle in art pixels, from the sprite's
// opaque extent.
func EnemyRadius(kind EnemyKind, faction EnemyFaction) float64 {
	const (
		scout, fighter, frigate, dreadnought = 11, 12, 19, 44
		nairanFighter, nautolanShip          = 14, 15
		bomber, nautolanBomber               = 16, 14
		torpedo, nautolanTorpedo             = 20, 19
	)
	switch {
	case kind == EnemyBomber && faction == Nautolan:
		return nautolanBomber
	case kind == EnemyBomber:
		return bomber
	case kind == EnemyTorpedo && faction == Nautolan:
		return nautolanTorpedo
	case kind == EnemyTorpedo:
		return torpedo
	case kind == EnemyFrigate:
		return frigate
	case kind == EnemyDreadnought:
		return dreadnought
	case faction == Nautolan:
		return nautolanShip
	case kind == EnemyFighter && faction == Nairan:
		return nairanFighter
	case kind == EnemyFighter:
		return fighter
	default:
		return scout
	}
}

// LeadAngle is the angle to fire from (x, y) so a shot at speed, leaving
// delay seconds from now, meets a target at (tx, ty) moving at (vx, vy)
// (#9 decision 15). Where no shot can catch the target it aims straight at
// it.
func LeadAngle(x, y, tx, ty, vx, vy, speed, delay float64) float64 {
	// Where the target is when the shot leaves, from the muzzle.
	qx, qy := tx+vx*delay-x, ty+vy*delay-y
	// The flight time t solves |q + v*t| = speed*t: a*t*t + 2*h*t + c = 0.
	a := vx*vx + vy*vy - speed*speed
	h := qx*vx + qy*vy
	c := qx*qx + qy*qy
	var times []float64
	const still = 1e-9
	switch d := h*h - a*c; {
	case math.Abs(a) < still && h < 0:
		times = append(times, -c/(h+h))
	case math.Abs(a) >= still && d >= 0:
		root := math.Sqrt(d)
		times = append(times, (-h-root)/a, (-h+root)/a)
	default:
	}
	t := math.Inf(1)
	for _, candidate := range times {
		if candidate > 0 {
			t = math.Min(t, candidate)
		}
	}
	if math.IsInf(t, 1) {
		return math.Atan2(ty-y, tx-x)
	}

	return math.Atan2(qy+vy*t, qx+vx*t)
}

// EnemyHP is an enemy's hit points, as the server has them, for picking the
// weakest target; a Frigate's is its least, for one player.
func EnemyHP(kind EnemyKind) float64 {
	const scout, fighter, bomber, torpedo = 2, 6, 10, 8
	switch kind {
	case EnemyFighter:
		return fighter
	case EnemyBomber:
		return bomber
	case EnemyTorpedo:
		return torpedo
	case EnemyFrigate:
		return FrigateHP(1)
	case EnemyDreadnought:
		return DreadnoughtMaxHP(1)
	case EnemyScout:
		fallthrough
	default:
		return scout
	}
}

// DreadnoughtMaxHP is the Dreadnought's maximum health for the weight of the
// players online: each player weighs 1, each companion FrigateCompanionWeight.
func DreadnoughtMaxHP(weight float64) float64 {
	return DreadnoughtBaseHP + DreadnoughtHPPerPlayer*weight
}

// DreadnoughtRegen is the share of its health left after hours of
// regenerating, never above all of it.
func DreadnoughtRegen(share, hours float64) float64 {
	if hours <= 0 {
		return share
	}

	return math.Min(1, share+hours*DreadnoughtRegenPerHour)
}

// FrigateHP is a Frigate's hit points for the weight of the players online:
// each player weighs 1, each companion FrigateCompanionWeight.
func FrigateHP(weight float64) float64 {
	return FrigateBaseHP + FrigateHPPerPlayer*weight
}

// IsSupport reports whether an enemy is a Support Ship, which companions can
// be told to go for first. None exist until that class arrives.
func IsSupport(EnemyKind) bool {
	return false
}
