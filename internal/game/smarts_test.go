package game_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// stepAs reports ship as s's state for n ticks and returns everything but
// the snapshots s was sent.
func stepAs(
	t *testing.T,
	s *Session,
	tick func(int),
	n int,
	ship *pb.ShipState,
) []*pb.ServerMessage {
	t.Helper()

	var others []*pb.ServerMessage
	for range n {
		s.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_State{State: ship}})
		tick(1)
		for {
			msg := next(t, s)
			if msg.GetSnapshot() != nil {
				break
			}
			others = append(others, msg)
		}
	}

	return others
}

// firstVolley steps until the enemy fires and returns that volley.
func firstVolley(t *testing.T, s *Session, tick func(int), ship *pb.ShipState) *pb.EnemyFired {
	t.Helper()

	for range 10 * TickRate {
		others := stepAs(t, s, tick, 1, ship)
		for _, msg := range others {
			if f := msg.GetEnemyFired(); f != nil {
				return f
			}
		}
	}
	t.Fatal("no enemy fired within 10 s")

	return nil
}

func TestEnemies_LaterFactionsLeadTheirShots(t *testing.T) {
	t.Parallel()

	moving := &pb.ShipState{X: 0, Y: 400, Vx: 150}
	for _, tc := range []struct {
		faction sim.EnemyFaction
		leads   bool
	}{{sim.Klaed, false}, {sim.Nairan, true}, {sim.Nautolan, true}} {
		hub, tick := testHub(
			t,
			NoEvents,
			WithEnemyOf(pb.EnemyKind_ENEMY_KIND_FIGHTER, tc.faction, 0, 700),
		)
		a, _ := join(t, hub, "a")
		f := firstVolley(t, a, tick, moving)
		ex, ey := float64(f.GetX()), float64(f.GetY())
		straight := math.Atan2(400-ey, 0-ex)
		lead := sim.LeadAngle(
			ex, ey, 0, 400, 150, 0,
			sim.EnemyBulletStatsOf(sim.EnemyBullet(sim.EnemyFighter, tc.faction)).Speed,
			float64(FireWarning)/TickRate,
		)
		want := straight
		if tc.leads {
			want = lead
		}
		if got := float64(f.GetAngle()); math.Abs(sim.WrapAngle(got-want)) > 1e-3 {
			t.Errorf(
				"%s fired along %.3f, want %.3f (straight %.3f, led %.3f)",
				tc.faction,
				got,
				want,
				straight,
				lead,
			)
		}
	}
}

func TestEnemies_LaterFactionsFlankTheirTarget(t *testing.T) {
	t.Parallel()

	spread := func(faction sim.EnemyFaction) float64 {
		hub, tick := testHub(t, NoEvents,
			WithEnemyOf(pb.EnemyKind_ENEMY_KIND_BOMBER, faction, 0, 760),
			WithEnemyOf(pb.EnemyKind_ENEMY_KIND_BOMBER, faction, 10, 760),
			WithEnemyOf(pb.EnemyKind_ENEMY_KIND_BOMBER, faction, -10, 760),
		)
		a, _ := join(t, hub, "a")
		snap := must(latest(t, a, tick, 15*TickRate, 0, 400))
		bearings := make([]float64, 0, len(snap.GetEnemies()))
		for _, e := range snap.GetEnemies() {
			bearings = append(bearings, math.Atan2(float64(e.GetY())-400, float64(e.GetX())))
		}
		widest := 0.0
		for i := range bearings {
			for j := range i {
				widest = math.Max(widest, math.Abs(sim.WrapAngle(bearings[i]-bearings[j])))
			}
		}

		return widest
	}
	// Bumping spreads any pack a little; flanking puts them on all sides.
	klaed, nairan := spread(sim.Klaed), spread(sim.Nairan)
	if nairan < 2 || nairan < 2*klaed {
		t.Errorf(
			"Nairan Bombers %.2f rad apart around their target and Kla'ed ones %.2f, want the Nairan spread out",
			nairan,
			klaed,
		)
	}
}

func TestEnemies_TheNautolanPickOffTheWeak(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		faction sim.EnemyFaction
		atWeak  bool
	}{{sim.Klaed, false}, {sim.Nairan, false}, {sim.Nautolan, true}} {
		hub, tick := testHub(
			t,
			NoEvents,
			WithEnemyOf(pb.EnemyKind_ENEMY_KIND_FIGHTER, tc.faction, 0, 700),
		)
		a, _ := join(t, hub, "a")
		b, _ := join(t, hub, "b")
		var f *pb.EnemyFired
		for range 10 * TickRate {
			b.Send(
				&pb.ClientMessage{
					Kind: &pb.ClientMessage_State{State: &pb.ShipState{X: 260, Y: 520, Damage: 2}},
				},
			)
			others := stepAs(t, a, tick, 1, &pb.ShipState{X: 0, Y: 450})
			drain(b)
			for _, msg := range others {
				if fired := msg.GetEnemyFired(); fired != nil && f == nil {
					f = fired
				}
			}
			if f != nil {
				break
			}
		}
		if f == nil {
			t.Fatalf("%s: no volley", tc.faction)
		}
		toA := math.Atan2(450-float64(f.GetY()), 0-float64(f.GetX()))
		toB := math.Atan2(520-float64(f.GetY()), 260-float64(f.GetX()))
		atB := math.Abs(
			sim.WrapAngle(float64(f.GetAngle())-toB),
		) < math.Abs(
			sim.WrapAngle(float64(f.GetAngle())-toA),
		)
		if atB != tc.atWeak {
			t.Errorf(
				"%s fired at the damaged ship further off: %t, want %t",
				tc.faction,
				atB,
				tc.atWeak,
			)
		}
	}
}

func TestEnemies_TheNautolanDodgeShotsComingAtThem(t *testing.T) {
	t.Parallel()

	sidestep := func(faction sim.EnemyFaction) float64 {
		hub, tick := testHub(
			t,
			NoEvents,
			WithEnemyOf(pb.EnemyKind_ENEMY_KIND_BOMBER, faction, 0, 700),
		)
		a, _ := join(t, hub, "a")
		snap := must(latest(t, a, tick, 10*TickRate, 0, 400))
		b := heavyAt(snap, pb.EnemyKind_ENEMY_KIND_BOMBER)
		angle := math.Atan2(float64(b.GetY())-400, float64(b.GetX()))
		a.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_Shot{Shot: &pb.ShotFired{
			Id: 1, Weapon: pb.Weapon_WEAPON_AUTO_CANNON, Y: 400, Angle: float32(angle),
		}}})
		after := heavyAt(must(latest(t, a, tick, 16, 0, 400)), pb.EnemyKind_ENEMY_KIND_BOMBER)
		dx, dy := float64(after.GetX()-b.GetX()), float64(after.GetY()-b.GetY())

		return math.Abs(-dx*math.Sin(angle) + dy*math.Cos(angle))
	}
	if got := sidestep(sim.Klaed); got > 3 {
		t.Errorf("a Kla'ed Bomber moved %.1f px off the shot's line, want it not to dodge", got)
	}
	if got := sidestep(sim.Nautolan); got < 8 {
		t.Errorf("a Nautolan Bomber moved %.1f px off the shot's line, want it to sidestep", got)
	}
}
