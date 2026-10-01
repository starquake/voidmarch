package sim

// EnemyPattern expands "enemy fired at angle with seed" into its bullets.
// Pure and seeded, so every client makes the same bullets from the server's
// one message.
func EnemyPattern(kind EnemyKind, x, y, angle float64, seed uint32) []ProjectileSpawn {
	random := NewRandom(seed)
	if kind == EnemyFrigate {
		return frigateRing(x, y, angle+random.Next()*Tau/FrigateRingBullets)
	}
	aim := angle + (random.Next()*2-1)*EnemyAimJitter
	muzzle := RotateOffset(EnemyMuzzle, 0, aim)

	return []ProjectileSpawn{
		{Kind: ProjectileKind(EnemyBullet(kind)), X: x + muzzle.X, Y: y + muzzle.Y, Angle: aim},
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
