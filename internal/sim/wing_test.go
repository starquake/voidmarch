package sim_test

import (
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

func TestWing_FollowsAnOwnerItOnlyObserves(t *testing.T) {
	t.Parallel()

	var w Wing
	c := w.Add(1, 0, 300)
	if len(w.Step(nil, nil)) != 0 || c.Ship.X != 0 || c.Ship.Y != 300 {
		t.Fatalf("stepped before seeing its owner: %+v", c.Ship)
	}
	owner := Mover{Y: 100, Angle: -1.5707963267948966}
	for range 3 * TickRate {
		w.Observe(owner)
		w.Step(nil, nil)
	}
	slot := FormationPoint(owner, 0, 1)
	if d := dist(c.Ship.X, c.Ship.Y, slot.X, slot.Y); d >= BrainInFormation {
		t.Errorf("%v from its slot behind the owner, want in it", d)
	}
}

func TestWing_ShotsNameTheirCompanion(t *testing.T) {
	t.Parallel()

	var w Wing
	w.Add(2, 0, 0)
	enemies := []BrainEnemy{{ID: 1, Y: -150}}
	shots := make([]CompanionShot, 0, 16)
	for range 2 * TickRate {
		w.Observe(Mover{Y: 40})
		shots = append(shots, w.Step(enemies, nil)...)
	}
	if len(shots) == 0 {
		t.Fatal("the companion never fired")
	}
	for _, s := range shots {
		if s.Companion != 2 {
			t.Errorf("shot from companion %d, want 2", s.Companion)
		}
	}
}

func TestWing_AddRemoveFind(t *testing.T) {
	t.Parallel()

	var w Wing
	w.Add(1, 0, 0)
	w.Add(2, 0, 0)
	if w.Find(2) == nil || w.Find(3) != nil {
		t.Error("Find() doesn't find what was added")
	}
	if !w.Remove(1) || w.Remove(1) || len(w.Companions) != 1 {
		t.Errorf("after removing 1 twice: %d companions, want 1", len(w.Companions))
	}
}

func TestWing_CompanionsSentToOnePointSpreadOut(t *testing.T) {
	t.Parallel()

	// Apart at first, and on one point, where the formation slot picks the way out.
	for _, gap := range []float64{10, 0} {
		var w Wing
		// Both come to one derelict, on its side they came from.
		w.Derelicts = []Vec{{X: 200, Y: 0}}
		a := w.Add(1, 0, 0)
		b := w.Add(2, gap, 0)
		for range 4 * TickRate {
			w.Observe(Mover{X: -300})
			w.Step(nil, nil)
		}
		if d := dist(a.Ship.X, a.Ship.Y, b.Ship.X, b.Ship.Y); d < 2*ShipRadius {
			t.Errorf(
				"starting %v apart, two companions sent to one point end %v apart; want at least %v, not touching",
				gap,
				d,
				2*ShipRadius,
			)
		}
	}
}

func TestWing_KeepsClearOfOtherShips(t *testing.T) {
	t.Parallel()

	owner := Mover{X: -300}
	slot := FormationPoint(owner, 0, 1)
	other := Friend{X: slot.X - 20, Y: slot.Y}
	var alone, crowded Wing
	lone := alone.Add(1, slot.X, slot.Y)
	nudged := crowded.Add(1, slot.X, slot.Y)
	for range 2 * TickRate {
		alone.Observe(owner)
		crowded.Observe(owner)
		alone.Step(nil, nil)
		// Another player parked just left of its slot.
		crowded.Step(nil, []Friend{other})
	}
	if nudged.Ship.X <= lone.Ship.X {
		t.Errorf(
			"beside another ship at x %v, alone at %v; want it further from the other ship",
			nudged.Ship.X,
			lone.Ship.X,
		)
	}
	if d := dist(nudged.Ship.X, nudged.Ship.Y, other.X, other.Y); d >= BrainSpacing+1 {
		t.Errorf(
			"%v from the other ship, want no farther than about BrainSpacing (%v): only a nudge",
			d,
			BrainSpacing,
		)
	}
}

func TestWing_KeepsClearOfItsOwner(t *testing.T) {
	t.Parallel()

	// Sent to a derelict right where its owner parks, it keeps its distance.
	var w Wing
	w.Derelicts = []Vec{{}}
	c := w.Add(1, 10, 0)
	for range 4 * TickRate {
		w.Observe(Mover{Angle: -1.5707963267948966})
		w.Step(nil, nil)
	}
	if d := dist(c.Ship.X, c.Ship.Y, 0, 0); d < BrainOwnerSpacing-5 {
		t.Errorf("%v from its owner, want about BrainOwnerSpacing (%v)", d, BrainOwnerSpacing)
	}
}

func TestWing_GoingHomeEndsThere(t *testing.T) {
	t.Parallel()

	var w Wing
	c := w.Add(1, 600, 0)
	c.GoingHome = true
	for tick := 0; c.GoingHome; tick++ {
		if tick > 10*TickRate {
			t.Fatalf("still going home after 10 s, at (%v, %v)", c.Ship.X, c.Ship.Y)
		}
		// Its owner, last seen far out, no longer leads it.
		w.Observe(Mover{X: 600})
		w.Step(nil, nil)
	}
	if d := dist(c.Ship.X, c.Ship.Y, 0, 0); d > BrainHomeRadius {
		t.Errorf("stopped going home %v from home, want within %v", d, BrainHomeRadius)
	}
}
