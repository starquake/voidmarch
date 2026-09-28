package sim_test

import (
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

func TestApplyWorldEdge(t *testing.T) {
	t.Parallel()

	inBand := float64(WorldHalfSize - WorldEdgeBand/2)
	ship := NewShip(inBand, -inBand, DefaultLoadout())
	ApplyWorldEdge(ship, TickSeconds)
	if ship.VX >= 0 || ship.VY <= 0 {
		t.Errorf("in the edge band: v = (%v, %v), want pushed toward the center", ship.VX, ship.VY)
	}

	ship = NewShip(100, 100, DefaultLoadout())
	ApplyWorldEdge(ship, TickSeconds)
	if ship.VX != 0 || ship.VY != 0 {
		t.Errorf("in the middle: v = (%v, %v), want no push", ship.VX, ship.VY)
	}
}

func TestApplyWorldEdge_StopsAtTheEdge(t *testing.T) {
	t.Parallel()

	ship := NewShip(WorldHalfSize+50, 0, DefaultLoadout())
	ship.VX = 300
	ApplyWorldEdge(ship, TickSeconds)
	if ship.X != WorldHalfSize || ship.VX != 0 {
		t.Errorf("flying out: x %v, vx %v, want stopped at %d", ship.X, ship.VX, WorldHalfSize)
	}

	ship = NewShip(-(WorldHalfSize + 50), 0, DefaultLoadout())
	ship.VX = 300
	ApplyWorldEdge(ship, TickSeconds)
	if ship.X != -WorldHalfSize || ship.VX <= 0 {
		t.Errorf(
			"past the edge flying in: x %v, vx %v, want at the edge, still flying in",
			ship.X,
			ship.VX,
		)
	}
}

func TestProjectileInBounds(t *testing.T) {
	t.Parallel()

	tests := []struct {
		x, y float64
		want bool
	}{
		{0, 0, true},
		{WorldHalfSize + 10, 0, true},
		{0, -(WorldHalfSize + 500), false},
	}
	for _, tc := range tests {
		if got := ProjectileInBounds(tc.x, tc.y); got != tc.want {
			t.Errorf("ProjectileInBounds(%v, %v) = %t, want %t", tc.x, tc.y, got, tc.want)
		}
	}
}
