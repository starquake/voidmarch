package sim

import "math"

// Frontier is which sectors are open (#123): home and the rings up to
// OpenRings, and any sector Opened on its own, like the Dreadnought's (#8).
// The zero Frontier has every ring open.
type Frontier struct {
	OpenRings int
	Opened    map[Sector]bool
}

// Open reports whether ships may fly in s.
func (f Frontier) Open(s Sector) bool {
	rings := f.OpenRings
	if rings == 0 {
		rings = GridRings
	}

	return s.Ring() <= rings || f.Opened[s]
}

// ApplyFrontier pushes the ship back from the closed sectors around it, in
// the edge band, as the world's edge does, and stops it at their sides.
func ApplyFrontier(ship *Ship, f Frontier, dt float64) {
	here, ok := SectorAt(ship.X, ship.Y)
	if !ok {
		return
	}
	if !f.Open(here) {
		if here, ok = backInside(ship, f, here); !ok {
			return
		}
	}
	for _, n := range here.Neighbors() {
		if f.Open(n) {
			continue
		}
		d := n.Beyond(ship.X, ship.Y)
		if d >= WorldEdgeBand {
			continue
		}
		hc, nc := here.Center(), n.Center()
		ax, ay := unit(hc.X-nc.X, hc.Y-nc.Y)
		push := (1 - d/WorldEdgeBand) * WorldEdgePush * dt
		ship.VX += ax * push
		ship.VY += ay * push
	}
}

// backInside moves a ship in the closed sector closed into its nearest open
// neighbor, stopping its flight out of it, and returns that neighbor.
func backInside(ship *Ship, f Frontier, closed Sector) (Sector, bool) {
	var best Sector
	found, nearest := false, math.Inf(1)
	for _, n := range closed.Neighbors() {
		if d := n.Beyond(ship.X, ship.Y); f.Open(n) && d < nearest {
			best, nearest, found = n, d, true
		}
	}
	if !found {
		return Sector{}, false
	}
	x, y := best.Clamp(ship.X, ship.Y, 1)
	ix, iy := unit(x-ship.X, y-ship.Y)
	if v := ship.VX*ix + ship.VY*iy; v < 0 {
		ship.VX -= v * ix
		ship.VY -= v * iy
	}
	ship.X, ship.Y = x, y

	return best, true
}

// unit is (x, y) scaled to length 1, or (0, 0).
func unit(x, y float64) (ux, uy float64) {
	l := math.Hypot(x, y)
	if l == 0 {
		return 0, 0
	}

	return x / l, y / l
}
