package sim

import (
	"fmt"
	"math"
)

// Sector is a flat-top hexagon of the world's grid (#117), in axial
// coordinates: home is (0, 0), and the grid reaches GridRings rings out.
type Sector struct {
	Q, R int
}

// HomeSector is the sector the home planet is in.
func HomeSector() Sector {
	return Sector{}
}

// SectorAt is the sector (x, y) is in, and false outside the grid.
func SectorAt(x, y float64) (Sector, bool) {
	q := (twoThirds * x) / SectorRadius
	r := (-x/three + sqrt3*y/three) / SectorRadius
	s := roundHex(q, r)

	return s, s.Valid()
}

// roundHex is the hex the fractional axial coordinates (q, r) fall in.
func roundHex(q, r float64) Sector {
	s := -q - r
	rq, rr, rs := round(q), round(r), round(s)
	dq, dr, ds := math.Abs(rq-q), math.Abs(rr-r), math.Abs(rs-s)
	switch {
	case dq > dr && dq > ds:
		rq = -rr - rs
	case dr > ds:
		rr = -rq - rs
	default:
	}

	return Sector{Q: int(rq), R: int(rr)}
}

// Valid reports whether the sector is on the grid.
func (s Sector) Valid() bool {
	return s.Ring() <= GridRings
}

// Ring is how many sectors s is from home: 0 for home, 1 for the 6 around
// it, and so on out.
func (s Sector) Ring() int {
	return max(abs(s.Q), abs(s.R), abs(s.Q+s.R))
}

// Neighbors are the six sectors around s that are on the grid.
func (s Sector) Neighbors() []Sector {
	directions := []Sector{{0, -1}, {1, -1}, {1, 0}, {0, 1}, {-1, 1}, {-1, 0}}
	out := make([]Sector, 0, len(directions))
	for _, d := range directions {
		if n := (Sector{Q: s.Q + d.Q, R: s.R + d.R}); n.Valid() {
			out = append(out, n)
		}
	}

	return out
}

// Name is the sector's name, column letter then row number: "D4".
func (s Sector) Name() string {
	const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
	col, row := s.colRow()
	if col < 0 || col >= len(letters) {
		return fmt.Sprintf("?%d", row+1)
	}

	return fmt.Sprintf("%c%d", letters[col], row+1)
}

// ParseSector reads a sector's name, and false for one off the grid.
func ParseSector(name string) (Sector, bool) {
	if len(name) < 2 || name[0] < 'A' {
		return Sector{}, false
	}
	var row int
	if _, err := fmt.Sscanf(name[1:], "%d", &row); err != nil {
		return Sector{}, false
	}
	q := int(name[0]-'A') - GridRings
	s := Sector{Q: q, R: row - 1 - GridRings - (q-(q&1))/2}
	if s.Name() != name {
		return Sector{}, false
	}

	return s, s.Valid()
}

// Center is the sector's middle.
func (s Sector) Center() Vec {
	return Vec{
		X: SectorRadius * threeHalves * float64(s.Q),
		Y: SectorRadius * sqrt3 * (float64(s.R) + float64(s.Q)/2),
	}
}

// SectorApothem is a sector's center-to-side distance.
const SectorApothem = SectorRadius * sqrt3 * half

// Beyond is how far (x, y) is outside the sector's sides, 0 inside: the
// distance to the nearest side's line, a little short off a corner.
func (s Sector) Beyond(x, y float64) float64 {
	c := s.Center()

	return math.Max(0, hexReach(sectorNormals(), x-c.X, y-c.Y)-SectorApothem)
}

// Inside reports whether (x, y) is inside the sector by at least margin from
// each of its sides.
func (s Sector) Inside(x, y, margin float64) bool {
	c := s.Center()

	return hexReach(sectorNormals(), x-c.X, y-c.Y) <= SectorApothem-margin
}

// Clamp is (x, y) moved inside the sector, margin in from its sides.
func (s Sector) Clamp(x, y, margin float64) (cx, cy float64) {
	c := s.Center()
	cx, cy = hexClamp(sectorNormals(), x-c.X, y-c.Y, SectorApothem-margin)

	return cx + c.X, cy + c.Y
}

// Contains reports whether (x, y) is inside the sector.
func (s Sector) Contains(x, y float64) bool {
	at, ok := SectorAt(x, y)

	return ok && at == s
}

// colRow is s on the odd-q offset grid that names it, from 0, with home at
// column 3 and row 3 (D4).
func (s Sector) colRow() (col, row int) {
	return s.Q + GridRings, s.R + (s.Q-(s.Q&1))/2 + GridRings
}

// sectorNormals are a sector's side normals, each for a side and the one
// opposite it.
func sectorNormals() hexSides {
	return hexSides{{Y: 1}, {X: sqrt3 * half, Y: half}, {X: -sqrt3 * half, Y: half}}
}

// Sectors lists every sector on the grid, by row then column of their names.
func Sectors() []Sector {
	var out []Sector
	for row := range 2*GridRings + 1 {
		for col := range 2*GridRings + 1 {
			q := col - GridRings
			s := Sector{Q: q, R: row - GridRings - (q-(q&1))/2}
			if s.Valid() {
				out = append(out, s)
			}
		}
	}

	return out
}

func abs(n int) int {
	if n < 0 {
		return -n
	}

	return n
}

// MissionFor is the default mission (#101): of the open, uncleared sectors in
// the ring nearest home, the one nearest near, so ring 1 comes first; a tie
// goes to the first by name. It reports false when every open sector is
// cleared.
func MissionFor(cleared map[Sector]bool, f Frontier, near Vec) (Sector, bool) {
	const tie = 1e-6
	var best Sector
	found := false
	bestRing, bestDistance := 0, math.Inf(1)
	for _, s := range Sectors() {
		if s == HomeSector() || cleared[s] || !f.Open(s) {
			continue
		}
		c := s.Center()
		d := math.Hypot(c.X-near.X, c.Y-near.Y)
		if !found || s.Ring() < bestRing || (s.Ring() == bestRing && d < bestDistance-tie) {
			best, bestRing, bestDistance, found = s, s.Ring(), d, true
		}
	}

	return best, found
}
