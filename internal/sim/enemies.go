package sim

// EnemyKind is an enemy class, matching the protocol's EnemyKind.
type EnemyKind string

// The enemy classes.
const (
	EnemyScout   EnemyKind = "scout"
	EnemyFighter EnemyKind = "fighter"
)

// EnemyBulletID names an enemy bullet from the Kla'ed projectiles.
type EnemyBulletID string

// The enemy bullets.
const (
	KlaedBullet    EnemyBulletID = "klaedBullet"
	KlaedBigBullet EnemyBulletID = "klaedBigBullet"
)

// EnemyKinds lists every enemy class.
func EnemyKinds() []EnemyKind {
	return []EnemyKind{EnemyScout, EnemyFighter}
}

// EnemyBullet is each enemy's bullet: the Scout's small one, the Fighter's
// big one.
func EnemyBullet(kind EnemyKind) EnemyBulletID {
	if kind == EnemyFighter {
		return KlaedBigBullet
	}

	return KlaedBullet
}

// EnemyRadius is an enemy's hit circle in art pixels, from the sprite's
// opaque extent.
func EnemyRadius(kind EnemyKind) float64 {
	const scout, fighter = 11, 12
	if kind == EnemyFighter {
		return fighter
	}

	return scout
}

// EnemyHP is an enemy's hit points, as the server has them, for picking the
// weakest target.
func EnemyHP(kind EnemyKind) float64 {
	const scout, fighter = 2, 6
	if kind == EnemyFighter {
		return fighter
	}

	return scout
}

// IsSupport reports whether an enemy is a Support Ship, which companions can
// be told to go for first. None exist until that class arrives.
func IsSupport(EnemyKind) bool {
	return false
}
