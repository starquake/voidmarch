package sim

// EnemyPattern expands "enemy fired at angle with seed" into its bullets.
// Pure and seeded, so every client makes the same bullets from the server's
// one message.
func EnemyPattern(kind EnemyKind, x, y, angle float64, seed uint32) []ProjectileSpawn {
	random := NewRandom(seed)
	aim := angle + (random.Next()*2-1)*EnemyAimJitter
	muzzle := RotateOffset(EnemyMuzzle, 0, aim)

	return []ProjectileSpawn{
		{Kind: ProjectileKind(EnemyBullet(kind)), X: x + muzzle.X, Y: y + muzzle.Y, Angle: aim},
	}
}
