package sim_test

import (
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

func TestSectorAt(t *testing.T) {
	t.Parallel()

	tests := []struct {
		x, y float64
		want string
		ok   bool
	}{
		{0, 0, "D4", true},
		{0, -1600, "D3", true},
		{-1600, -1600, "C3", true},
		{799, 799, "D4", true},
		{800, 0, "E4", true},
		{-WorldHalfSize, -WorldHalfSize, "A1", true},
		{WorldHalfSize - 1, WorldHalfSize - 1, "G7", true},
		{WorldHalfSize + 1, 0, "", false},
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
		{"C3", 1, -1600, -1600},
		{"E4", 1, 1600, 0},
		{"B4", 2, -3200, 0},
		{"G7", 3, 4800, 4800},
	}
	for _, tc := range tests {
		s, ok := ParseSector(tc.name)
		if !ok {
			t.Fatalf("ParseSector(%q) failed", tc.name)
		}
		if s.Name() != tc.name || s.Ring() != tc.ring || s.Center() != (Vec{X: tc.x, Y: tc.y}) {
			t.Errorf("%s: name %s, ring %d, center %+v; want ring %d at (%v, %v)",
				tc.name, s.Name(), s.Ring(), s.Center(), tc.ring, tc.x, tc.y)
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

	for _, name := range []string{"", "D", "H1", "A0", "A8", "d4", "D04", "4D"} {
		if s, ok := ParseSector(name); ok {
			t.Errorf("ParseSector(%q) = %s, want invalid", name, s.Name())
		}
	}
}

func TestSectors_RingsHold8_16And24(t *testing.T) {
	t.Parallel()

	count := map[int]int{}
	for _, s := range Sectors() {
		count[s.Ring()]++
	}
	if count[0] != 1 || count[1] != 8 || count[2] != 16 || count[3] != 24 {
		t.Errorf("sectors per ring = %v, want home 1, then 8, 16 and 24", count)
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
