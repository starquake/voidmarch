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
	if kind == EnemySupport {
		return nil
	}
	random := NewRandom(seed)
	if kind == EnemyFrigate {
		bullet, count := FrigateRing(faction)

		return ringOf(x, y, angle+random.Next()*Tau/float64(count), bullet, count)
	}
	if kind == EnemyDreadnought {
		return dreadnoughtPattern(x, y, angle, seed, random, faction)
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
// seed says, so every client expands it the same way (#124). Each faction
// fills them with its own: the Kla'ed fire a ring, a Ray sweep and a Wave
// spread; the Nairan a Torpedo volley, a Ray sweep and a Rocket spread
// (#140); the Nautolan a ring of Spinning Bullets, a Ray sweep, a spiral of
// them and a Wave spread (#153, #273).
type DreadnoughtVolley int

// The Dreadnought's volleys, which it takes in turn; named for the Kla'ed's,
// but for the spiral, the Nautolan one's own.
const (
	DreadnoughtRing DreadnoughtVolley = iota
	DreadnoughtRay
	DreadnoughtWave
	// DreadnoughtSpiral is one burst of a spiral: a ring of
	// DreadnoughtSpiralArms, the first along the angle.
	DreadnoughtSpiral
	dreadnoughtVolleys
)

// DreadnoughtSeed is seed made to say volley.
func DreadnoughtSeed(seed uint32, volley DreadnoughtVolley) uint32 {
	return seed - seed%uint32(dreadnoughtVolleys) + uint32(volley) //nolint:gosec // 0 to 3.
}

// DreadnoughtVolleyOf is the volley a Dreadnought's seed says.
func DreadnoughtVolleyOf(seed uint32) DreadnoughtVolley {
	return DreadnoughtVolley(seed % uint32(dreadnoughtVolleys))
}

// DreadnoughtSpiralBursts is how many bursts a spiral fires.
const DreadnoughtSpiralBursts = int(DreadnoughtSpiralSeconds / DreadnoughtSpiralEvery)

// DreadnoughtSpiralAngle is the angle of a spiral's burst, counted from 0:
// a step on round the turn from DreadnoughtSpiralStart for each burst,
// turning the positive way for 1 and the negative for -1 (#273).
func DreadnoughtSpiralAngle(burst, way int) float64 {
	return DreadnoughtSpiralStart + Tau*float64(way*burst)/float64(DreadnoughtSpiralBursts)
}

// DreadnoughtTurn is the order faction's Dreadnought takes its volleys in:
// the Nautolan one's spiral comes between its Ray sweep and its Wave
// spread, keeping its two volleys of Spinning Bullets apart (#273).
func DreadnoughtTurn(faction EnemyFaction) []DreadnoughtVolley {
	if faction == Nautolan {
		return []DreadnoughtVolley{
			DreadnoughtRing, DreadnoughtRay, DreadnoughtSpiral, DreadnoughtWave,
		}
	}

	return []DreadnoughtVolley{DreadnoughtRing, DreadnoughtRay, DreadnoughtWave}
}

// dreadnoughtShots are the beam and the spread shot of faction's
// Dreadnought.
func dreadnoughtShots(faction EnemyFaction) (ray, spread EnemyBulletID) {
	switch faction {
	case Nairan:
		return NairanRay, NairanRocket
	case Nautolan:
		return NautolanRay, NautolanWave
	case Klaed:
		fallthrough
	default:
		return KlaedRay, KlaedWave
	}
}

// dreadnoughtPattern is the Dreadnought's volley the seed names: one beam
// of a Ray sweep along angle, a spread of Waves or Rockets, one burst of a
// spiral, or a ring of its faction's Frigate shot or, for the Nairan, a fan
// of Torpedoes.
func dreadnoughtPattern(
	x, y, angle float64,
	seed uint32,
	random *Random,
	faction EnemyFaction,
) []ProjectileSpawn {
	ray, spread := dreadnoughtShots(faction)
	switch DreadnoughtVolleyOf(seed) {
	case DreadnoughtRay:
		beam := make([]ProjectileSpawn, 0, DreadnoughtRaySegments)
		for i := range DreadnoughtRaySegments {
			d := DreadnoughtMuzzle + float64(i)*DreadnoughtRaySpacing
			beam = append(beam, ProjectileSpawn{
				Kind:  ProjectileKind(ray),
				X:     x + d*math.Cos(angle),
				Y:     y + d*math.Sin(angle),
				Angle: angle,
			})
		}

		return beam
	case DreadnoughtWave:
		return dreadnoughtFan(x, y, angle, spread, DreadnoughtWaves, DreadnoughtWaveSpread)
	case DreadnoughtSpiral:
		bullet, _ := FrigateRing(faction)

		return dreadnoughtRing(x, y, angle, bullet, DreadnoughtSpiralArms)
	case DreadnoughtRing, dreadnoughtVolleys:
		fallthrough
	default:
		if faction == Nairan {
			return dreadnoughtFan(
				x,
				y,
				angle,
				NairanTorpedo,
				DreadnoughtTorpedoes,
				DreadnoughtTorpedoFan,
			)
		}
		bullet, count := FrigateRing(faction)

		return dreadnoughtRing(x, y, angle+random.Next()*Tau/float64(count), bullet, count)
	}
}

// dreadnoughtRing is a ring of count bullets evenly spaced around the
// Dreadnought, the first at angle, leaving from its muzzle.
func dreadnoughtRing(
	x, y, angle float64,
	bullet EnemyBulletID,
	count int,
) []ProjectileSpawn {
	ring := ringOf(x, y, angle, bullet, count)
	for i := range ring {
		ring[i].X += (DreadnoughtMuzzle - FrigateMuzzle) * math.Cos(ring[i].Angle)
		ring[i].Y += (DreadnoughtMuzzle - FrigateMuzzle) * math.Sin(ring[i].Angle)
	}

	return ring
}

// dreadnoughtFan is count shots spread evenly across spread radians around
// angle, from the Dreadnought's muzzle.
func dreadnoughtFan(
	x, y, angle float64,
	shot EnemyBulletID,
	count int,
	spread float64,
) []ProjectileSpawn {
	fan := make([]ProjectileSpawn, 0, count)
	for i := range count {
		aim := angle + spread*(float64(i)/float64(count-1)-half)
		muzzle := RotateOffset(DreadnoughtMuzzle, 0, aim)
		fan = append(fan, ProjectileSpawn{
			Kind: ProjectileKind(shot), X: x + muzzle.X, Y: y + muzzle.Y, Angle: aim,
		})
	}

	return fan
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
