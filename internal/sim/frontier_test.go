package sim_test

import (
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

func sector(t *testing.T, name string) Sector {
	t.Helper()

	s, ok := ParseSector(name)
	if !ok {
		t.Fatalf("ParseSector(%q) failed", name)
	}

	return s
}

func TestFrontier_Open(t *testing.T) {
	t.Parallel()

	ringOne := Frontier{OpenRings: 1}
	withD2 := Frontier{OpenRings: 1, Opened: map[Sector]bool{sector(t, "D2"): true}}
	tests := []struct {
		f    Frontier
		name string
		want bool
	}{
		{Frontier{}, "D1", true},
		{ringOne, "D4", true},
		{ringOne, "D3", true},
		{ringOne, "D2", false},
		{ringOne, "D1", false},
		{withD2, "D2", true},
		{withD2, "C2", false},
	}
	for _, tc := range tests {
		if got := tc.f.Open(sector(t, tc.name)); got != tc.want {
			t.Errorf("%+v.Open(%s) = %t, want %t", tc.f, tc.name, got, tc.want)
		}
	}
}

// d3Top is the y of D3's side with D2, straight up from home.
var d3Top = -3 * SectorApothem

func TestApplyFrontier_PushesBackInTheBand(t *testing.T) {
	t.Parallel()

	ship := NewShip(0, d3Top+WorldEdgeBand/2, DefaultLoadout())
	ship.VY = -100
	ApplyFrontier(ship, Frontier{OpenRings: 1}, TickSeconds)
	if ship.VY <= -100 || ship.VX != 0 {
		t.Errorf("near closed D2: v = (%v, %v), want pushed back down", ship.VX, ship.VY)
	}

	ship = NewShip(0, d3Top+WorldEdgeBand/2, DefaultLoadout())
	ship.VY = -100
	ApplyFrontier(ship, Frontier{}, TickSeconds)
	if ship.VY != -100 {
		t.Errorf("with every ring open: vy = %v, want no push", ship.VY)
	}

	ship = NewShip(0, -SectorApothem*2, DefaultLoadout())
	ApplyFrontier(ship, Frontier{OpenRings: 1}, TickSeconds)
	if ship.VX != 0 || ship.VY != 0 {
		t.Errorf("in the middle of D3: v = (%v, %v), want no push", ship.VX, ship.VY)
	}
}

func TestApplyFrontier_StopsAtAClosedSide(t *testing.T) {
	t.Parallel()

	ship := NewShip(0, d3Top-20, DefaultLoadout())
	ship.VX, ship.VY = 50, -300
	ApplyFrontier(ship, Frontier{OpenRings: 1}, TickSeconds)
	if s, _ := SectorAt(ship.X, ship.Y); s.Name() != "D3" {
		t.Errorf(
			"flying into closed D2: at (%v, %v) in %s, want back in D3",
			ship.X,
			ship.Y,
			s.Name(),
		)
	}
	if ship.VY < 0 || ship.VX != 50 {
		t.Errorf(
			"flying into closed D2: v = (%v, %v), want (50, 0 or more): stopped going in, still sliding along",
			ship.VX,
			ship.VY,
		)
	}
}

func TestApplyFrontier_LeavesWhatItCantFix(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		x, y float64
	}{
		{"deep in a closed ring, no open sector beside it", 0, -6 * SectorApothem},
		{"off the grid", WorldApothem - 10, 0},
	}
	for _, tc := range tests {
		ship := NewShip(tc.x, tc.y, DefaultLoadout())
		ship.VY = -10
		ApplyFrontier(ship, Frontier{OpenRings: 1}, TickSeconds)
		if ship.X != tc.x || ship.Y != tc.y || ship.VY != -10 {
			t.Errorf(
				"%s: ship at (%v, %v) v %v, want it left alone",
				tc.name,
				ship.X,
				ship.Y,
				ship.VY,
			)
		}
	}
}

func TestSandbox_ADownedShipDriftsNoFurtherThanAClosedSide(t *testing.T) {
	t.Parallel()

	s := NewSandbox()
	s.Frontier = Frontier{OpenRings: 1}
	s.Ship.X, s.Ship.Y = 0, d3Top+10
	s.Ship.VY = -300
	s.Ship.Damage = MaxDamage
	for range 300 {
		s.AdvanceCommand(TickSeconds, Command{})
	}
	if !s.Ship.Downed() {
		t.Fatal("the ship came back up, so it didn't drift down")
	}
	if s.Ship.Y < d3Top {
		t.Errorf("downed ship at y = %v, past D3's side with closed D2 at %v", s.Ship.Y, d3Top)
	}
}
