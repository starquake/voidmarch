package sim_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

// slant is the normal of the world edge's lower right side.
var slant = Vec{X: 0.5, Y: math.Sqrt(3) / 2}

func along(x, y float64, n Vec) float64 {
	return x*n.X + y*n.Y
}

func TestApplyWorldEdge(t *testing.T) {
	t.Parallel()

	inBand := float64(WorldApothem - WorldEdgeBand/2)
	ship := NewShip(inBand, 0, DefaultLoadout())
	ApplyWorldEdge(ship, TickSeconds)
	if ship.VX >= 0 || ship.VY != 0 {
		t.Errorf("in the right band: v = (%v, %v), want pushed left", ship.VX, ship.VY)
	}

	ship = NewShip(slant.X*inBand, slant.Y*inBand, DefaultLoadout())
	ApplyWorldEdge(ship, TickSeconds)
	if v := along(ship.VX, ship.VY, slant); v >= 0 {
		t.Errorf("in the lower right band: v along the normal = %v, want pushed in", v)
	}

	ship = NewShip(100, 100, DefaultLoadout())
	ApplyWorldEdge(ship, TickSeconds)
	if ship.VX != 0 || ship.VY != 0 {
		t.Errorf("in the middle: v = (%v, %v), want no push", ship.VX, ship.VY)
	}
}

func TestApplyWorldEdge_StopsAtTheEdge(t *testing.T) {
	t.Parallel()

	ship := NewShip(WorldApothem+50, 0, DefaultLoadout())
	ship.VX = 300
	ApplyWorldEdge(ship, TickSeconds)
	if ship.X != WorldApothem || ship.VX != 0 {
		t.Errorf("flying out: x %v, vx %v, want stopped at %v", ship.X, ship.VX, WorldApothem)
	}

	ship = NewShip(-(WorldApothem + 50), 0, DefaultLoadout())
	ship.VX = 300
	ApplyWorldEdge(ship, TickSeconds)
	if ship.X != -WorldApothem || ship.VX <= 0 {
		t.Errorf(
			"past the edge flying in: x %v, vx %v, want at the edge, still flying in",
			ship.X,
			ship.VX,
		)
	}

	past := float64(WorldApothem + 50)
	ship = NewShip(slant.X*past, slant.Y*past, DefaultLoadout())
	ship.VX, ship.VY = 300*slant.X, 300*slant.Y
	ApplyWorldEdge(ship, TickSeconds)
	reach, v := WorldReach(ship.X, ship.Y), along(ship.VX, ship.VY, slant)
	if math.Abs(reach-WorldApothem) > 1e-9 || math.Abs(v) > 1e-9 {
		t.Errorf(
			"flying out the lower right: reach %v, v along the normal %v; want at the edge, stopped",
			reach,
			v,
		)
	}
}

func TestWorldReachAndClamp(t *testing.T) {
	t.Parallel()

	tests := []struct {
		x, y, reach float64
	}{
		{0, 0, 0},
		{-3000, 0, 3000},
		{0, 2000, 2000 * math.Sqrt(3) / 2},
		{1000, 1000, 500 + 1000*math.Sqrt(3)/2},
	}
	for _, tc := range tests {
		if got := WorldReach(tc.x, tc.y); math.Abs(got-tc.reach) > 1e-9 {
			t.Errorf("WorldReach(%v, %v) = %v, want %v", tc.x, tc.y, got, tc.reach)
		}
	}

	for _, p := range []Vec{{X: 9000}, {Y: -9000}, {X: 6000, Y: 6000}, {X: 100, Y: 100}} {
		x, y := ClampToWorld(p.X, p.Y, 10)
		if WorldReach(x, y) > WorldApothem-10+1e-9 {
			t.Errorf(
				"ClampToWorld(%v, %v, 10) = (%v, %v), reach %v; want inside",
				p.X,
				p.Y,
				x,
				y,
				WorldReach(x, y),
			)
		}
	}
	if x, y := ClampToWorld(100, 100, 10); x != 100 || y != 100 {
		t.Errorf("ClampToWorld(100, 100) = (%v, %v), want unmoved", x, y)
	}
}

func TestProjectileInBounds(t *testing.T) {
	t.Parallel()

	corner := WorldApothem * 2 / math.Sqrt(3)
	tests := []struct {
		x, y float64
		want bool
	}{
		{0, 0, true},
		{WorldApothem + 10, 0, true},
		{WorldApothem + 100, 0, false},
		{0, -(corner + 10), true},
		{0, -(corner + 500), false},
		{slant.X * (WorldApothem + 100), slant.Y * (WorldApothem + 100), false},
	}
	for _, tc := range tests {
		if got := ProjectileInBounds(tc.x, tc.y); got != tc.want {
			t.Errorf("ProjectileInBounds(%v, %v) = %t, want %t", tc.x, tc.y, got, tc.want)
		}
	}
}
