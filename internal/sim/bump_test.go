package sim_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

func TestTouching(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name  string
		a, b  Body
		side  float64
		want  Contact
		touch bool
	}{
		{
			name: "apart",
			a:    Body{X: 0, Radius: 12},
			b:    Body{X: 30, Radius: 12},
		},
		{
			name:  "overlapping at rest",
			a:     Body{X: 0, Radius: 12},
			b:     Body{X: 20, Radius: 12},
			want:  Contact{NX: -1, Depth: 4},
			touch: true,
		},
		{
			name:  "closing",
			a:     Body{X: 0, VX: 100, Radius: 12},
			b:     Body{X: 20, VX: -50, Radius: 12},
			want:  Contact{NX: -1, Depth: 4, Closing: 150},
			touch: true,
		},
		{
			name:  "parting",
			a:     Body{X: 0, VX: -100, Radius: 12},
			b:     Body{X: 20, Radius: 12},
			want:  Contact{NX: -1, Depth: 4, Closing: -100},
			touch: true,
		},
		{
			name:  "same place, one side",
			a:     Body{Radius: 12},
			b:     Body{Radius: 12},
			side:  1,
			want:  Contact{NX: 1, Depth: 24},
			touch: true,
		},
		{
			name:  "same place, the other side",
			a:     Body{Radius: 12},
			b:     Body{Radius: 12},
			side:  -1,
			want:  Contact{NX: -1, Depth: 24},
			touch: true,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, touch := Touching(tc.a, tc.b, tc.side)
			if touch != tc.touch || got != tc.want {
				t.Errorf("Touching() = %+v, %v, want %+v, %v", got, touch, tc.want, tc.touch)
			}
		})
	}
}

func TestContact_Hurts(t *testing.T) {
	t.Parallel()

	if (Contact{Closing: RammingSpeed - 1}).Hurts() {
		t.Error("a gentle contact rammed")
	}
	if !(Contact{Closing: RammingSpeed}).Hurts() {
		t.Error("a contact at RammingSpeed didn't ram")
	}
}

func TestContact_From(t *testing.T) {
	t.Parallel()

	// The other body is to the right: the normal points left, at this one.
	c, _ := Touching(Body{X: 0, Radius: 12}, Body{X: 20, Radius: 12}, 1)
	if got := c.From(); math.Abs(got) > 1e-9 {
		t.Errorf("From() = %v, want 0 (the other is to the right)", got)
	}
}

func TestApart(t *testing.T) {
	t.Parallel()

	a := Body{X: 0, VX: 100, VY: 30, Radius: 12}
	b := Body{X: 20, Radius: 12}
	c, _ := Touching(a, b, 1)

	whole := Apart(a, c, 1)
	if _, touch := Touching(whole, b, 1); touch || whole.X != -4 {
		t.Errorf("Apart(share 1) at x %v, want -4, out of b", whole.X)
	}
	if whole.VX != 0 || whole.VY != 30 {
		t.Errorf(
			"Apart() velocity = (%v, %v), want (0, 30): only the part into b stops",
			whole.VX,
			whole.VY,
		)
	}
	if half := Apart(a, c, 0.5); half.X != -2 {
		t.Errorf("Apart(share 0.5) at x %v, want -2", half.X)
	}
	leaving := Body{X: 0, VX: -100, Radius: 12}
	if got := Apart(leaving, c, 1); got.VX != -100 {
		t.Errorf("Apart() of a body already leaving: vx %v, want -100 kept", got.VX)
	}
}

func TestShip_MoveTo(t *testing.T) {
	t.Parallel()

	s := NewShip(1, 2, DefaultLoadout())
	s.VX, s.VY = 3, 4
	if got, want := ShipBody(s), (Body{X: 1, Y: 2, VX: 3, VY: 4, Radius: ShipRadius}); got != want {
		t.Errorf("ShipBody() = %+v, want %+v", got, want)
	}
	s.MoveTo(Body{X: 5, Y: 6, VX: 7, VY: 8})
	if s.X != 5 || s.Y != 6 || s.VX != 7 || s.VY != 8 {
		t.Errorf(
			"after MoveTo, ship at (%v, %v) moving (%v, %v), want (5, 6) moving (7, 8)",
			s.X,
			s.Y,
			s.VX,
			s.VY,
		)
	}
}

func TestRams(t *testing.T) {
	t.Parallel()

	var r Rams[string]
	if !r.Ready("a|b", 10) {
		t.Fatal("a first ram wasn't ready")
	}
	if r.Ready("a|b", 10+RammingCooldown/2) {
		t.Error("the same pair rammed again within the cooldown")
	}
	if !r.Ready("a|c", 10+RammingCooldown/2) {
		t.Error("another pair waited on a|b's cooldown")
	}
	if !r.Ready("a|b", 10+RammingCooldown) {
		t.Error("the pair couldn't ram again after the cooldown")
	}
	r.Forget(20)
	if got := r.Len(); got != 0 {
		t.Errorf("after Forget, %d pairs remembered, want 0", got)
	}
}
