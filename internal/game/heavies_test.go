package game_test

import (
	"log/slog"
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

func TestGarrison_Ring1DrawsItsHeavyShareAtKlaedStrength(t *testing.T) {
	t.Parallel()

	const places = 4000
	hub := NewHub(slog.New(slog.DiscardHandler), WithSeed(1))
	count := map[pb.EnemyKind]int{}
	for _, kind := range hub.GarrisonKinds(1, places) {
		count[kind]++
	}
	bombers, torpedoes := count[pb.EnemyKind_ENEMY_KIND_BOMBER], count[pb.EnemyKind_ENEMY_KIND_TORPEDO]
	drawn := places - count[pb.EnemyKind_ENEMY_KIND_SUPPORT]
	share, want := float64(bombers+torpedoes)/float64(drawn), sim.GarrisonHeavyShare(1)
	if math.Abs(share-want) > 0.02 {
		t.Errorf("ring 1 draws %.3f Bombers and Torpedo Ships, want about %v", share, want)
	}
	if bombers == 0 || torpedoes == 0 ||
		math.Abs(float64(bombers-torpedoes)) > float64(bombers+torpedoes)/4 {
		t.Errorf("%d Bombers and %d Torpedo Ships, want about half each", bombers, torpedoes)
	}
	for _, kind := range []pb.EnemyKind{pb.EnemyKind_ENEMY_KIND_BOMBER, pb.EnemyKind_ENEMY_KIND_TORPEDO} {
		klaed, klaedEvery := EnemyStatsFor(kind, sim.Klaed)
		nairan, nairanEvery := EnemyStatsFor(kind, sim.Nairan)
		if klaed >= nairan || klaedEvery <= nairanEvery {
			t.Errorf(
				"a Kla'ed %s has %d HP and fires every %d ticks, want fewer and slower than the Nairan's %d and %d",
				kind,
				klaed,
				klaedEvery,
				nairan,
				nairanEvery,
			)
		}
	}
}

func TestGarrison_EveryRingMixesInHeavies(t *testing.T) {
	t.Parallel()

	for _, sector := range []string{"E4", "D2", "D1"} {
		s, _ := sim.ParseSector(sector)
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
		if heavies == 0 {
			t.Errorf("%s: no Bombers or Torpedo Ships, want some", sector)
		}
	}
}
