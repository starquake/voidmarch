package sim_test

import (
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

func TestWing_FollowsAnOwnerItOnlyObserves(t *testing.T) {
	t.Parallel()

	var w Wing
	c := w.Add(1, 0, 300, DefaultOrders())
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
	w.Add(2, 0, 0, ModeOrders(ModeAttack, DefaultOrders(), 0, 0))
	enemies := []BrainEnemy{{ID: 1, Kind: EnemyScout, Y: -150, AttackedWing: true}}
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
	w.Add(1, 0, 0, DefaultOrders())
	w.Add(2, 0, 0, DefaultOrders())
	if w.Find(2) == nil || w.Find(3) != nil {
		t.Error("Find() doesn't find what was added")
	}
	if !w.Remove(1) || w.Remove(1) || len(w.Companions) != 1 {
		t.Errorf("after removing 1 twice: %d companions, want 1", len(w.Companions))
	}
}

func TestWing_CompanionsHoldingOnePointSpreadOut(t *testing.T) {
	t.Parallel()

	// Apart at first, and on one point, where the formation slot picks the way out.
	for _, gap := range []float64{10, 0} {
		var w Wing
		hold := ModeOrders(ModeHold, DefaultOrders(), 200, 0)
		a := w.Add(1, 0, 0, hold)
		b := w.Add(2, gap, 0, hold)
		for range 4 * TickRate {
			w.Observe(Mover{X: -300})
			w.Step(nil, nil)
		}
		if d := dist(a.Ship.X, a.Ship.Y, b.Ship.X, b.Ship.Y); d < 2*ShipRadius {
			t.Errorf(
				"starting %v apart, two companions holding one point end %v apart; want at least %v, not touching",
				gap,
				d,
				2*ShipRadius,
			)
		}
	}
}

func TestWing_KeepsClearOfOtherShips(t *testing.T) {
	t.Parallel()

	hold := ModeOrders(ModeHold, DefaultOrders(), 200, 0)
	var alone, crowded Wing
	lone := alone.Add(1, 200, 0, hold)
	nudged := crowded.Add(1, 200, 0, hold)
	for range 2 * TickRate {
		alone.Observe(Mover{X: -300})
		crowded.Observe(Mover{X: -300})
		alone.Step(nil, nil)
		// Another player parked just left of the hold point.
		crowded.Step(nil, []Friend{{X: 180, Y: 0}})
	}
	if nudged.Ship.X <= lone.Ship.X {
		t.Errorf(
			"beside another ship at x %v, alone at %v; want it further from the other ship",
			nudged.Ship.X,
			lone.Ship.X,
		)
	}
	if d := dist(nudged.Ship.X, nudged.Ship.Y, 180, 0); d >= BrainSpacing+1 {
		t.Errorf(
			"%v from the other ship, want no farther than about BrainSpacing (%v): only a nudge",
			d,
			BrainSpacing,
		)
	}
}
