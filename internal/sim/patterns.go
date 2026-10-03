package sim

import "math"

// EnemyPattern expands "enemy fired at angle with seed" into its bullets.
// Pure and seeded, so every client makes the same bullets from the server's
// one message.
func EnemyPattern(
	kind EnemyKind,
	faction EnemyFaction,
	x, y, angle float64,
	seed uint32,
) []ProjectileSpawn {
	random := NewRandom(seed)
	if kind == EnemyFrigate {
		bullet, count := FrigateRing(faction)

		return ringOf(x, y, angle+random.Next()*Tau/float64(count), bullet, count)
	}
	if kind == EnemyDreadnought {
		return dreadnoughtPattern(x, y, angle, seed, random)
	}
	bullet := ProjectileKind(EnemyBullet(kind, faction))
	if kind == EnemyBomber {
		return bomberPair(bullet, x, y, angle)
	}
	if kind == EnemyTorpedo {
		// A Torpedo Ship lines up first, so its one shot goes straight down
		// the line it announced.
		muzzle := RotateOffset(EnemyMuzzle, 0, angle)

		return []ProjectileSpawn{{Kind: bullet, X: x + muzzle.X, Y: y + muzzle.Y, Angle: angle}}
	}
	aim := angle + (random.Next()*2-1)*EnemyAimJitter
	muzzle := RotateOffset(EnemyMuzzle, 0, aim)

	return []ProjectileSpawn{{Kind: bullet, X: x + muzzle.X, Y: y + muzzle.Y, Angle: aim}}
}

// bomberPair is a Bomber's two shots (#137 decision 2): they leave
// BomberSplay either side of angle and curve back in to cross the line
// BomberConverge along it, where the target was.
func bomberPair(bullet ProjectileKind, x, y, angle float64) []ProjectileSpawn {
	cos := math.Cos(BomberSplay)
	// Bent by Curve*f*f at f along its own line, a shot meets the aim line
	// at f = BomberConverge*cos.
	bend := math.Sin(BomberSplay) / (BomberConverge * cos * cos)
	muzzle := RotateOffset(EnemyMuzzle, 0, angle)
	sides := []float64{-1, 1}
	pair := make([]ProjectileSpawn, 0, len(sides))
	for _, side := range sides {
		aim := angle + side*BomberSplay
		pair = append(pair, ProjectileSpawn{
			Kind: bullet, X: x + muzzle.X, Y: y + muzzle.Y, Angle: aim, Curve: -side * bend,
		})
	}

	return pair
}

// DreadnoughtVolley is which of its attacks a Dreadnought volley is: the
// seed says, so every client expands it the same way (#124).
type DreadnoughtVolley int

// The Dreadnought's volleys, which it takes in turn.
const (
	DreadnoughtRing DreadnoughtVolley = iota
	DreadnoughtRay
	DreadnoughtWave
	dreadnoughtVolleys
)

// DreadnoughtSeed is seed made to say volley.
func DreadnoughtSeed(seed uint32, volley DreadnoughtVolley) uint32 {
	return seed - seed%uint32(dreadnoughtVolleys) + uint32(volley) //nolint:gosec // 0 to 2.
}

// dreadnoughtPattern is the Dreadnought's volley the seed names: a ring of big
// bullets, one beam of a Ray sweep along angle, or a spread of Waves.
func dreadnoughtPattern(x, y, angle float64, seed uint32, random *Random) []ProjectileSpawn {
	switch DreadnoughtVolley(seed % uint32(dreadnoughtVolleys)) {
	case DreadnoughtRay:
		beam := make([]ProjectileSpawn, 0, DreadnoughtRaySegments)
		for i := range DreadnoughtRaySegments {
			d := DreadnoughtMuzzle + float64(i)*DreadnoughtRaySpacing
			beam = append(beam, ProjectileSpawn{
				Kind: ProjectileKind(
					KlaedRay,
				),
				X:     x + d*math.Cos(angle),
				Y:     y + d*math.Sin(angle),
				Angle: angle,
			})
		}

		return beam
	case DreadnoughtWave:
		spread := make([]ProjectileSpawn, 0, DreadnoughtWaves)
		for i := range DreadnoughtWaves {
			aim := angle + DreadnoughtWaveSpread*(float64(i)/(DreadnoughtWaves-1)-half)
			muzzle := RotateOffset(DreadnoughtMuzzle, 0, aim)
			spread = append(spread, ProjectileSpawn{
				Kind: ProjectileKind(KlaedWave), X: x + muzzle.X, Y: y + muzzle.Y, Angle: aim,
			})
		}

		return spread
	case DreadnoughtRing, dreadnoughtVolleys:
		fallthrough
	default:
		ring := ringOf(
			x, y, angle+random.Next()*Tau/FrigateRingBullets, KlaedBigBullet, FrigateRingBullets,
		)
		for i := range ring {
			ring[i].X += (DreadnoughtMuzzle - FrigateMuzzle) * math.Cos(ring[i].Angle)
			ring[i].Y += (DreadnoughtMuzzle - FrigateMuzzle) * math.Sin(ring[i].Angle)
		}

		return ring
	}
}

// FrigateRing is the bullet a faction's Frigate rings with, and how many
// (#139): its faction's big shot, as many more as the faction fires more
// often (#9 decision 14), so a Nairan ring has 18 and a Nautolan one 24.
func FrigateRing(faction EnemyFaction) (EnemyBulletID, int) {
	count := int(math.Round(FrigateRingBullets * FactionStats(faction).Shots))

	return EnemyBullet(EnemyFighter, faction), count
}

// ringOf is a ring of count bullets evenly spaced around the Frigate,
// the first at angle.
func ringOf(x, y, angle float64, bullet EnemyBulletID, count int) []ProjectileSpawn {
	ring := make([]ProjectileSpawn, 0, count)
	for i := range count {
		aim := angle + Tau*float64(i)/float64(count)
		muzzle := RotateOffset(FrigateMuzzle, 0, aim)
		ring = append(ring, ProjectileSpawn{
			Kind: ProjectileKind(bullet), X: x + muzzle.X, Y: y + muzzle.Y, Angle: aim,
		})
	}

	return ring
}
