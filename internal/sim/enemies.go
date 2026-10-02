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
)

// EnemyBulletID names an enemy bullet from the Kla'ed projectiles.
type EnemyBulletID string

// The enemy bullets.
const (
	KlaedBullet    EnemyBulletID = "klaedBullet"
	KlaedBigBullet EnemyBulletID = "klaedBigBullet"
	// KlaedRay and KlaedWave are the Dreadnought's (#124).
	KlaedRay  EnemyBulletID = "klaedRay"
	KlaedWave EnemyBulletID = "klaedWave"
)

// EnemyKinds lists every enemy class.
func EnemyKinds() []EnemyKind {
	return []EnemyKind{EnemyScout, EnemyFighter, EnemyFrigate, EnemyDreadnought}
}

// EnemyBullet is each enemy's bullet: the Scout's small one, the big one
// for the rest.
func EnemyBullet(kind EnemyKind) EnemyBulletID {
	if kind != EnemyScout {
		return KlaedBigBullet
	}

	return KlaedBullet
}

// EnemyRadius is an enemy's hit circle in art pixels, from the sprite's
// opaque extent.
func EnemyRadius(kind EnemyKind) float64 {
	const scout, fighter, frigate, dreadnought = 11, 12, 19, 44
	switch kind {
	case EnemyFighter:
		return fighter
	case EnemyFrigate:
		return frigate
	case EnemyDreadnought:
		return dreadnought
	case EnemyScout:
		fallthrough
	default:
		return scout
	}
}

// EnemyHP is an enemy's hit points, as the server has them, for picking the
// weakest target; a Frigate's is its least, for one player.
func EnemyHP(kind EnemyKind) float64 {
	const scout, fighter = 2, 6
	switch kind {
	case EnemyFighter:
		return fighter
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
// ships near it: each player weighs 1, each companion FrigateCompanionWeight.
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

// FrigateHP is a Frigate's hit points for the weight of the players near it
// when the fight starts: each player weighs 1, each companion FrigateCompanionWeight.
func FrigateHP(weight float64) float64 {
	return FrigateBaseHP + FrigateHPPerPlayer*weight
}

// IsSupport reports whether an enemy is a Support Ship, which companions can
// be told to go for first. None exist until that class arrives.
func IsSupport(EnemyKind) bool {
	return false
}
