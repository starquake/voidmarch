package sim

import "math"

// ApplyWorldEdge pushes the ship back inside the edge band, and stops it at
// the edge itself.
func ApplyWorldEdge(ship *Ship, dt float64) {
	edgeAxis(&ship.X, &ship.VX, dt)
	edgeAxis(&ship.Y, &ship.VY, dt)
}

func edgeAxis(pos, vel *float64, dt float64) {
	const inner = WorldHalfSize - WorldEdgeBand
	distance := math.Abs(*pos)
	if distance > inner {
		depth := math.Min(1, (distance-inner)/WorldEdgeBand)
		*vel -= sign(*pos) * depth * WorldEdgePush * dt
	}
	if distance > WorldHalfSize {
		*pos = sign(*pos) * WorldHalfSize
		if sign(*vel) == sign(*pos) {
			*vel = 0
		}
	}
}

// ProjectileInBounds reports whether a projectile at (x, y) is still worth
// simulating.
func ProjectileInBounds(x, y float64) bool {
	const limit = WorldHalfSize + projectileMargin

	return math.Abs(x) <= limit && math.Abs(y) <= limit
}
