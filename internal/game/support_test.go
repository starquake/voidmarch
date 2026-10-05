package game_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// hitFor has s report a hit of damage on enemy with shot.
func hitFor(s *Session, enemy, shot, damage uint32) {
	s.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_Hit{Hit: &pb.Hit{
		EnemyId: enemy, ShotId: shot, Damage: damage,
	}}})
}

// enemyByID is snap's enemy with id, or nil.
func enemyByID(snap *pb.Snapshot, id uint32) *pb.EnemyState {
	for _, e := range snap.GetEnemies() {
		if e.GetEnemyId() == id {
			return e
		}
	}

	return nil
}

// idle is where the player waits in TestSupportShip tests: out of every
// enemy's reach, so the ships placed below it hold still.
const idleX, idleY = 0, 300

func TestSupportShip_RepairsAMateInRangeUpToItsStartingHP(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(
		t,
		NoEvents,
		WithEnemyOf(pb.EnemyKind_ENEMY_KIND_SUPPORT, sim.Klaed, 0, 900),
		WithEnemyOf(pb.EnemyKind_ENEMY_KIND_FIGHTER, sim.Klaed, 100, 900),
	)
	a, _ := join(t, hub, "a")
	snap := must(latest(t, a, tick, 1, idleX, idleY))
	support := heavyAt(snap, pb.EnemyKind_ENEMY_KIND_SUPPORT)
	fighter := heavyAt(snap, pb.EnemyKind_ENEMY_KIND_FIGHTER)
	if support.GetRepairing() != 0 {
		t.Errorf("repairing %d with nobody damaged, want none", support.GetRepairing())
	}
	full, _ := EnemyStatsFor(pb.EnemyKind_ENEMY_KIND_FIGHTER, sim.Klaed)

	// Down to 2 HP, then 3 s of repairs: back to 5, so a hit of 4 leaves it.
	hitFor(a, fighter.GetEnemyId(), 1, uint32(full-2)) //nolint:gosec // a few hit points.
	snap = must(latest(t, a, tick, 3*TickRate+1, idleX, idleY))
	if got := enemyByID(snap, support.GetEnemyId()).GetRepairing(); got != fighter.GetEnemyId() {
		t.Errorf("repairing %d, want the damaged Fighter %d", got, fighter.GetEnemyId())
	}
	hitFor(a, fighter.GetEnemyId(), 2, 4)
	snap = must(latest(t, a, tick, 1, idleX, idleY))
	if enemyByID(snap, fighter.GetEnemyId()) == nil {
		t.Fatal("the Fighter went down, want it repaired by 3 HP in 3 s")
	}

	// Long enough to repair it many times over: never above where it started.
	snap = must(latest(t, a, tick, 10*TickRate, idleX, idleY))
	if got := enemyByID(snap, support.GetEnemyId()).GetRepairing(); got != 0 {
		t.Errorf("repairing %d once the Fighter is whole, want none", got)
	}
	hitFor(a, fighter.GetEnemyId(), 3, uint32(full)) //nolint:gosec // a few hit points.
	snap = must(latest(t, a, tick, 1, idleX, idleY))
	if enemyByID(snap, fighter.GetEnemyId()) != nil {
		t.Errorf("the Fighter took a hit of its starting %d HP and stayed, want it down", full)
	}
}

func TestSupportShip_LeavesAMateOutOfRange(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(
		t,
		NoEvents,
		WithEnemyOf(pb.EnemyKind_ENEMY_KIND_SUPPORT, sim.Klaed, -200, 900),
		WithEnemyOf(pb.EnemyKind_ENEMY_KIND_FIGHTER, sim.Klaed, 200, 900),
	)
	a, _ := join(t, hub, "a")
	snap := must(latest(t, a, tick, 1, idleX, idleY))
	fighter := heavyAt(snap, pb.EnemyKind_ENEMY_KIND_FIGHTER)
	full, _ := EnemyStatsFor(pb.EnemyKind_ENEMY_KIND_FIGHTER, sim.Klaed)
	hitFor(a, fighter.GetEnemyId(), 1, uint32(full-2)) //nolint:gosec // a few hit points.
	snap = must(latest(t, a, tick, 3*TickRate, idleX, idleY))
	if got := heavyAt(snap, pb.EnemyKind_ENEMY_KIND_SUPPORT).GetRepairing(); got != 0 {
		t.Errorf("repairing %d, 400 px away, want none", got)
	}
	hitFor(a, fighter.GetEnemyId(), 2, 2)
	snap = must(latest(t, a, tick, 1, idleX, idleY))
	if enemyByID(snap, fighter.GetEnemyId()) != nil {
		t.Error("the Fighter out of range took its last 2 HP and stayed, want it down")
	}
}

func TestSupportShip_RepairsAFrigatesShieldFirst(t *testing.T) {
	t.Parallel()

	d3, _ := sim.ParseSector("D3")
	c := d3.Center()
	hub, tick := testHub(
		t,
		NoEvents,
		WithMap(frigateMap),
		WithEnemyOf(pb.EnemyKind_ENEMY_KIND_SUPPORT, sim.Klaed, c.X, c.Y-120),
	)
	a, _ := join(t, hub, "a")
	x, y := inFrigateRange(t, a, tick)
	f := frigateIn(must(latest(t, a, tick, 1, x, y)))
	hitFrigate(a, f.GetEnemyId(), 1)
	hitFrigate(a, f.GetEnemyId(), 2)
	f = frigateIn(must(latest(t, a, tick, 1, x, y)))
	hp := f.GetHp()
	if f.GetShield() != 0 {
		t.Fatalf("shield %v after two hits, want it down", f.GetShield())
	}
	f = frigateIn(must(latest(t, a, tick, 2*TickRate, x, y)))
	if f.GetShield() != 2 || f.GetHp() != hp {
		t.Errorf(
			"after 2 s: shield %v, hp %v; want the shield repaired to 2 and the hull left at %v",
			f.GetShield(),
			f.GetHp(),
			hp,
		)
	}
}

func TestSupportShip_KeepsBehindItsPackAndNeverFires(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(
		t,
		NoEvents,
		WithEnemyOf(pb.EnemyKind_ENEMY_KIND_SUPPORT, sim.Klaed, 0, 650),
		WithEnemyOf(pb.EnemyKind_ENEMY_KIND_FIGHTER, sim.Klaed, -60, 800),
		WithEnemyOf(pb.EnemyKind_ENEMY_KIND_FIGHTER, sim.Klaed, 60, 800),
	)
	a, _ := join(t, hub, "a")
	const playerY = 450
	var snap *pb.Snapshot
	for range 10 {
		var others []*pb.ServerMessage
		snap, others = latest(t, a, tick, TickRate, 0, playerY)
		for _, msg := range others {
			if f := msg.GetEnemyFired(); f.GetKind() == pb.EnemyKind_ENEMY_KIND_SUPPORT {
				t.Fatal("the Support Ship fired, want no guns")
			}
		}
	}
	var mates [][2]float64
	var support *pb.EnemyState
	for _, e := range snap.GetEnemies() {
		if e.GetKind() == pb.EnemyKind_ENEMY_KIND_SUPPORT {
			support = e

			continue
		}
		mates = append(mates, [2]float64{float64(e.GetX()), float64(e.GetY())})
	}
	if support == nil || len(mates) == 0 {
		t.Fatalf("enemies %v, want the Support Ship and its pack", snap.GetEnemies())
	}
	var cx, cy float64
	for _, m := range mates {
		cx += m[0] / float64(len(mates))
		cy += m[1] / float64(len(mates))
	}
	sx, sy := float64(support.GetX()), float64(support.GetY())
	toPack := math.Hypot(cx, cy-playerY)
	toSupport := math.Hypot(sx, sy-playerY)
	if toSupport < toPack+SupportBehind/2 {
		t.Errorf(
			"the Support Ship is %.0f px from the player and its pack %.0f, want it %d px behind",
			toSupport,
			toPack,
			SupportBehind,
		)
	}
}

func TestGarrison_DrawsItsShareOfSupportShips(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		sector string
		want   int
	}{{"E4", 1}, {"D1", 2}} {
		s, _ := sim.ParseSector(tc.sector)
		c := s.Center()
		hub, tick := testHub(t, WithOpenRings(3), NoEvents)
		a, _ := join(t, hub, "a")
		snap := must(latest(t, a, tick, 1, float32(c.X), float32(c.Y)))
		support := 0
		for _, e := range snap.GetEnemies() {
			if e.GetKind() == pb.EnemyKind_ENEMY_KIND_SUPPORT {
				support++
			}
		}
		if size := sim.GarrisonSize(s.Ring()); support != tc.want {
			t.Errorf(
				"%s: %d Support Ships in a garrison of %d, want %d",
				tc.sector,
				support,
				size,
				tc.want,
			)
		}
	}
}
