package game_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// heavyAt is the enemy of kind in snap, or nil.
func heavyAt(snap *pb.Snapshot, kind pb.EnemyKind) *pb.EnemyState {
	for _, e := range snap.GetEnemies() {
		if e.GetKind() == kind {
			return e
		}
	}

	return nil
}

func TestTorpedoShip_HoldsStillThroughItsLongerWarning(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(
		t,
		NoEvents,
		WithEnemyOf(pb.EnemyKind_ENEMY_KIND_TORPEDO, sim.Nairan, 0, 700),
	)
	a, _ := join(t, hub, "a")
	var fired *pb.EnemyFired
	for range 10 * TickRate {
		_, others := latest(t, a, tick, 1, 0, 400)
		for _, msg := range others {
			if f := msg.GetEnemyFired(); f != nil &&
				f.GetKind() == pb.EnemyKind_ENEMY_KIND_TORPEDO {
				fired = f
			}
		}
		if fired != nil {
			break
		}
	}
	if fired == nil {
		t.Fatal("the Torpedo Ship never fired")
	}
	warned := fired.GetWarnTicks()
	if warned != TorpedoWarning || warned <= FireWarning {
		t.Errorf(
			"warned %d ticks, want %d, longer than the others' %d",
			warned,
			TorpedoWarning,
			FireWarning,
		)
	}
	held := heavyAt(must(latest(t, a, tick, 2, 0, 400)), pb.EnemyKind_ENEMY_KIND_TORPEDO)
	at, angle := [2]float32{held.GetX(), held.GetY()}, held.GetAngle()
	later := heavyAt(
		must(latest(t, a, tick, TorpedoWarning-4, 0, 400)),
		pb.EnemyKind_ENEMY_KIND_TORPEDO,
	)
	if moved := math.Hypot(float64(later.GetX()-at[0]), float64(later.GetY()-at[1])); moved > 6 {
		t.Errorf("moved %.1f px while lined up, want it holding still", moved)
	}
	if later.GetAngle() != angle || angle != fired.GetAngle() {
		t.Errorf(
			"turned from %v to %v while lined up along %v",
			angle,
			later.GetAngle(),
			fired.GetAngle(),
		)
	}
}

func TestBomber_KeepsItsDistance(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(
		t,
		NoEvents,
		WithEnemyOf(pb.EnemyKind_ENEMY_KIND_BOMBER, sim.Nairan, 0, 750),
	)
	a, _ := join(t, hub, "a")
	snap := must(latest(t, a, tick, 8*TickRate, 0, 400))
	b := heavyAt(snap, pb.EnemyKind_ENEMY_KIND_BOMBER)
	d := math.Hypot(float64(b.GetX()), float64(b.GetY())-400)
	if math.Abs(d-sim.BomberConverge) > 40 {
		t.Errorf("the Bomber is %.0f px from its target, want about %d", d, sim.BomberConverge)
	}
}

func TestGarrison_LaterRingsMixInHeavies(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		sector string
		heavy  bool
	}{{"E4", false}, {"D2", true}, {"D1", true}} {
		s, _ := sim.ParseSector(tc.sector)
		c := s.Center()
		hub, tick := testHub(t, WithOpenRings(3), NoEvents)
		a, _ := join(t, hub, "a")
		heavies := 0
		for _, e := range must(latest(t, a, tick, 1, float32(c.X), float32(c.Y))).GetEnemies() {
			if k := e.GetKind(); k == pb.EnemyKind_ENEMY_KIND_BOMBER ||
				k == pb.EnemyKind_ENEMY_KIND_TORPEDO {
				heavies++
			}
		}
		if got := heavies > 0; got != tc.heavy {
			t.Errorf(
				"%s: %d Bombers and Torpedo Ships, want some: %t",
				tc.sector,
				heavies,
				tc.heavy,
			)
		}
	}
}
