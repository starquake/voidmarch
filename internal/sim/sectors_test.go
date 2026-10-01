package sim_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

// Ring 1's centers, a sector's width apart from home's.
var (
	across = 1.5 * SectorRadius
	down   = math.Sqrt(3) * SectorRadius
)

func TestSectorAt(t *testing.T) {
	t.Parallel()

	tests := []struct {
		x, y float64
		want string
		ok   bool
	}{
		{0, 0, "D4", true},
		{0, -down, "D3", true},
		{across, down / 2, "E4", true},
		{across, -down / 2, "E3", true},
		{-across, -down / 2, "C3", true},
		{-across, down / 2, "C4", true},
		{0, down, "D5", true},
		{0, SectorApothem - 1, "D4", true},
		{0, SectorApothem + 1, "D5", true},
		{SectorRadius - 1, 0, "D4", true},
		{0, -3 * down, "D1", true},
		{3 * across, 1.5 * down, "G5", true},
		{-3 * across, 1.5 * down, "A5", true},
		{0, -3*down - SectorApothem - 1, "", false},
		{WorldApothem, 0, "", false},
	}
	for _, tc := range tests {
		s, ok := SectorAt(tc.x, tc.y)
		if ok != tc.ok || (ok && s.Name() != tc.want) {
			t.Errorf(
				"SectorAt(%v, %v) = %s, %t; want %s, %t",
				tc.x,
				tc.y,
				s.Name(),
				ok,
				tc.want,
				tc.ok,
			)
		}
	}
}

func TestSector_RingCenterAndName(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		ring int
		x, y float64
	}{
		{"D4", 0, 0, 0},
		{"D3", 1, 0, -down},
		{"E4", 1, across, down / 2},
		{"C3", 1, -across, -down / 2},
		{"B4", 2, -2 * across, 0},
		{"D1", 3, 0, -3 * down},
		{"G5", 3, 3 * across, 1.5 * down},
	}
	for _, tc := range tests {
		s, ok := ParseSector(tc.name)
		if !ok {
			t.Fatalf("ParseSector(%q) failed", tc.name)
		}
		c := s.Center()
		if s.Name() != tc.name || s.Ring() != tc.ring || math.Abs(c.X-tc.x) > 1e-9 ||
			math.Abs(c.Y-tc.y) > 1e-9 {
			t.Errorf("%s: name %s, ring %d, center %+v; want ring %d at (%v, %v)",
				tc.name, s.Name(), s.Ring(), c, tc.ring, tc.x, tc.y)
		}
		if !s.Contains(tc.x, tc.y) {
			t.Errorf("%s doesn't contain its own center", tc.name)
		}
	}
	if HomeSector().Name() != "D4" {
		t.Errorf("HomeSector() = %s, want D4", HomeSector().Name())
	}
}

func TestParseSector_Invalid(t *testing.T) {
	t.Parallel()

	for _, name := range []string{"", "D", "H1", "A0", "A1", "A6", "G1", "D8", "d4", "D04", "4D"} {
		if s, ok := ParseSector(name); ok {
			t.Errorf("ParseSector(%q) = %s, want invalid", name, s.Name())
		}
	}
}

func TestSectors_RingsHold6_12And18(t *testing.T) {
	t.Parallel()

	count := map[int]int{}
	names := map[string]bool{}
	for _, s := range Sectors() {
		count[s.Ring()]++
		names[s.Name()] = true
		if p, ok := ParseSector(s.Name()); !ok || p != s {
			t.Errorf("ParseSector(%q) = %+v, %t; want %+v", s.Name(), p, ok, s)
		}
	}
	if count[0] != 1 || count[1] != 6 || count[2] != 12 || count[3] != 18 {
		t.Errorf("sectors per ring = %v, want home 1, then 6, 12 and 18", count)
	}
	if len(names) != 37 {
		t.Errorf("%d sector names, want 37 different ones", len(names))
	}
}

func TestSector_Neighbors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		want int
	}{
		{"D4", 6},
		{"E4", 6},
		{"D1", 3},
		{"D2", 6},
		{"A3", 4},
	}
	for _, tc := range tests {
		s, _ := ParseSector(tc.name)
		got := s.Neighbors()
		if len(got) != tc.want {
			t.Errorf("%s has %d neighbors, want %d", tc.name, len(got), tc.want)
		}
		for _, n := range got {
			c, nc := s.Center(), n.Center()
			if d := math.Hypot(nc.X-c.X, nc.Y-c.Y); math.Abs(d-down) > 1e-9 {
				t.Errorf("%s's neighbor %s is %v away, want %v", tc.name, n.Name(), d, down)
			}
		}
	}
}

func TestSector_BeyondAndClamp(t *testing.T) {
	t.Parallel()

	e4, _ := ParseSector("E4")
	c := e4.Center()
	if got := e4.Beyond(c.X, c.Y+SectorApothem+40); math.Abs(got-40) > 1e-9 {
		t.Errorf("Beyond 40 under E4 = %v, want 40", got)
	}
	if got := e4.Beyond(c.X+100, c.Y); got != 0 {
		t.Errorf("Beyond inside E4 = %v, want 0", got)
	}
	for _, p := range []Vec{{X: c.X + 2000, Y: c.Y}, {X: c.X, Y: c.Y - 2000}, {X: 0, Y: 0}} {
		x, y := e4.Clamp(p.X, p.Y, 1)
		if !e4.Contains(x, y) || e4.Beyond(x, y) != 0 {
			t.Errorf("Clamp(%v, %v) = (%v, %v), not inside E4", p.X, p.Y, x, y)
		}
	}
	if x, y := e4.Clamp(c.X+10, c.Y-10, 1); x != c.X+10 || y != c.Y-10 {
		t.Errorf("Clamp inside E4 moved the point to (%v, %v)", x, y)
	}
}

func TestGarrisonSize(t *testing.T) {
	t.Parallel()

	for ring, want := range []int{0, 8, 12, 16} {
		if got := GarrisonSize(ring); got != want {
			t.Errorf("GarrisonSize(%d) = %d, want %d", ring, got, want)
		}
	}
	if GarrisonFighterShare(1) >= GarrisonFighterShare(3) {
		t.Error("the outer rings have no more Fighters than ring 1")
	}
}

func TestMissionFor(t *testing.T) {
	t.Parallel()

	sector := func(name string) Sector {
		s, _ := ParseSector(name)

		return s
	}
	tests := []struct {
		name    string
		cleared []string
		near    Vec
		want    string
	}{
		{"ring 1 first, nearest the squadron", nil, Vec{X: 1485, Y: 857}, "E4"},
		{"another squadron's spot", nil, Vec{X: 0, Y: -1700}, "D3"},
		{"a far squadron still gets ring 1", nil, Vec{X: 4455, Y: 2572}, "E4"},
		{"cleared sectors are skipped", []string{"E4"}, Vec{X: 1485, Y: 700}, "E3"},
		{"a tie goes to the first by name", nil, Vec{}, "C3"},
	}
	for _, tc := range tests {
		cleared := map[Sector]bool{}
		for _, n := range tc.cleared {
			cleared[sector(n)] = true
		}
		got, ok := MissionFor(cleared, tc.near)
		if !ok || got.Name() != tc.want {
			t.Errorf("%s: MissionFor() = %s, %t; want %s", tc.name, got.Name(), ok, tc.want)
		}
	}

	all := map[Sector]bool{}
	for _, s := range Sectors() {
		all[s] = true
	}
	if s, ok := MissionFor(all, Vec{}); ok {
		t.Errorf("MissionFor(everything cleared) = %s, want none", s.Name())
	}
}
