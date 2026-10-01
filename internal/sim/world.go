package sim

import "math"

// hexSides are a hexagon's side normals, each for a side and the one opposite
// it.
type hexSides [hexSidePairs]Vec

const hexSidePairs = 3

// edgeNormals are the world edge's side normals.
func edgeNormals() hexSides {
	return hexSides{{X: 1}, {X: half, Y: sqrt3 * half}, {X: -half, Y: sqrt3 * half}}
}

// WorldReach is how far (x, y) is from the center toward the world edge,
// which is at WorldApothem.
func WorldReach(x, y float64) float64 {
	return hexReach(edgeNormals(), x, y)
}

// ClampToWorld is (x, y) moved inside the edge, margin in from it.
func ClampToWorld(x, y, margin float64) (cx, cy float64) {
	return hexClamp(edgeNormals(), x, y, WorldApothem-margin)
}

// hexReach is how far (x, y) is from the center of a hexagon with these side
// normals, measured like its apothem.
func hexReach(normals hexSides, x, y float64) float64 {
	var reach float64
	for _, n := range normals {
		reach = math.Max(reach, math.Abs(x*n.X+y*n.Y))
	}

	return reach
}

// hexClamp is (x, y) moved inside the hexagon with these side normals and
// the apothem limit.
func hexClamp(normals hexSides, x, y, limit float64) (cx, cy float64) {
	cx, cy = x, y
	for _, n := range normals {
		if along := cx*n.X + cy*n.Y; math.Abs(along) > limit {
			excess := along - math.Copysign(limit, along)
			cx -= excess * n.X
			cy -= excess * n.Y
		}
	}

	return cx, cy
}

// ApplyWorldEdge pushes the ship back inside the edge band, and stops it at
// the edge itself.
func ApplyWorldEdge(ship *Ship, dt float64) {
	for _, n := range edgeNormals() {
		edgeSide(ship, n, dt)
	}
}

func edgeSide(ship *Ship, n Vec, dt float64) {
	const inner = WorldApothem - WorldEdgeBand
	along := ship.X*n.X + ship.Y*n.Y
	distance, out := math.Abs(along), sign(along)
	if distance > inner {
		push := math.Min(1, (distance-inner)/WorldEdgeBand) * WorldEdgePush * dt * out
		ship.VX -= push * n.X
		ship.VY -= push * n.Y
	}
	if distance > WorldApothem {
		excess := (distance - WorldApothem) * out
		ship.X -= excess * n.X
		ship.Y -= excess * n.Y
		if v := ship.VX*n.X + ship.VY*n.Y; sign(v) == out {
			ship.VX -= v * n.X
			ship.VY -= v * n.Y
		}
	}
}

// ProjectileInBounds reports whether a projectile at (x, y) is still worth
// simulating.
func ProjectileInBounds(x, y float64) bool {
	return WorldReach(x, y) <= WorldApothem+projectileMargin
}
