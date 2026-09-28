package sim_test

import (
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

func TestWing_FollowsAnOwnerItOnlyObserves(t *testing.T) {
	t.Parallel()

	var w Wing
	c := w.Add(1, 0, 300, DefaultOrders())
	if len(w.Step(nil)) != 0 || c.Ship.X != 0 || c.Ship.Y != 300 {
		t.Fatalf("stepped before seeing its owner: %+v", c.Ship)
	}
	owner := Mover{Y: 100, Angle: -1.5707963267948966}
	for range 3 * TickRate {
		w.Observe(owner)
		w.Step(nil)
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
		shots = append(shots, w.Step(enemies)...)
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
