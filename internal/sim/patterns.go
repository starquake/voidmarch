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
		return frigateRing(x, y, angle+random.Next()*Tau/FrigateRingBullets)
	}
	if kind == EnemyDreadnought {
		return dreadnoughtPattern(x, y, angle, seed, random)
	}
	aim := angle + (random.Next()*2-1)*EnemyAimJitter
	muzzle := RotateOffset(EnemyMuzzle, 0, aim)

	return []ProjectileSpawn{
		{
			Kind:  ProjectileKind(EnemyBullet(kind, faction)),
			X:     x + muzzle.X,
			Y:     y + muzzle.Y,
			Angle: aim,
		},
	}
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
		ring := frigateRing(x, y, angle+random.Next()*Tau/FrigateRingBullets)
		for i := range ring {
			ring[i].X += (DreadnoughtMuzzle - FrigateMuzzle) * math.Cos(ring[i].Angle)
			ring[i].Y += (DreadnoughtMuzzle - FrigateMuzzle) * math.Sin(ring[i].Angle)
		}

		return ring
	}
}

// frigateRing is a ring of FrigateRingBullets big bullets evenly spaced
// around the Frigate, the first at angle.
func frigateRing(x, y, angle float64) []ProjectileSpawn {
	ring := make([]ProjectileSpawn, 0, FrigateRingBullets)
	for i := range FrigateRingBullets {
		aim := angle + Tau*float64(i)/FrigateRingBullets
		muzzle := RotateOffset(FrigateMuzzle, 0, aim)
		ring = append(ring, ProjectileSpawn{
			Kind: ProjectileKind(KlaedBigBullet), X: x + muzzle.X, Y: y + muzzle.Y, Angle: aim,
		})
	}

	return ring
}
