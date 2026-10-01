package sim

import (
	"fmt"
	"math"
)

// Sector is a cell of the world's grid (#99): Col from 0 (A) and Row from 0
// (1), so home is in the middle, (GridSize/2, GridSize/2).
type Sector struct {
	Col, Row int
}

// HomeSector is the sector the home planet is in.
func HomeSector() Sector {
	const middle = GridSize / 2

	return Sector{Col: middle, Row: middle}
}

// SectorAt is the sector (x, y) is in, and false outside the world.
func SectorAt(x, y float64) (Sector, bool) {
	col := int(math.Floor((x + WorldHalfSize) / SectorSize))
	row := int(math.Floor((y + WorldHalfSize) / SectorSize))
	s := Sector{Col: col, Row: row}

	return s, s.Valid()
}

// Valid reports whether the sector is on the grid.
func (s Sector) Valid() bool {
	return s.Col >= 0 && s.Col < GridSize && s.Row >= 0 && s.Row < GridSize
}

// Name is the sector's name, column letter then row number: "D4".
func (s Sector) Name() string {
	const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
	if s.Col < 0 || s.Col >= len(letters) {
		return fmt.Sprintf("?%d", s.Row+1)
	}

	return fmt.Sprintf("%c%d", letters[s.Col], s.Row+1)
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
	s := Sector{Col: int(name[0] - 'A'), Row: row - 1}
	if s.Name() != name {
		return Sector{}, false
	}

	return s, s.Valid()
}

// Ring is how many cells the sector is from home: 0 for home, 1 for the 8
// around it, and so on out.
func (s Sector) Ring() int {
	home := HomeSector()

	return max(abs(s.Col-home.Col), abs(s.Row-home.Row))
}

// Center is the sector's middle.
func (s Sector) Center() Vec {
	return Vec{
		X: (float64(s.Col)+half)*SectorSize - WorldHalfSize,
		Y: (float64(s.Row)+half)*SectorSize - WorldHalfSize,
	}
}

// Contains reports whether (x, y) is inside the sector.
func (s Sector) Contains(x, y float64) bool {
	at, ok := SectorAt(x, y)

	return ok && at == s
}

// Sectors lists every sector, row by row.
func Sectors() []Sector {
	out := make([]Sector, 0, GridSize*GridSize)
	for row := range GridSize {
		for col := range GridSize {
			out = append(out, Sector{Col: col, Row: row})
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
