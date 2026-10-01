package game_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
)

// latest steps the hub n ticks, keeping s's ship at (x, y), and returns the
// last snapshot plus every other message s received meanwhile.
func latest(
	t *testing.T,
	s *Session,
	tick func(int),
	n int,
	x, y float32,
) (*pb.Snapshot, []*pb.ServerMessage) {
	t.Helper()

	var snap *pb.Snapshot
	var others []*pb.ServerMessage
	for range n {
		s.Send(state(x, y))
		tick(1)
		for {
			msg := next(t, s)
			if got := msg.GetSnapshot(); got != nil {
				snap = got

				break
			}
			others = append(others, msg)
		}
	}

	return snap, others
}

func TestEnemies_NoneWithoutPlayers(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	tick(3 * TickRate)
	s, _ := join(t, hub, "a")
	tick(1)

	if got := len(next(t, s).GetSnapshot().GetEnemies()); got != 0 {
		t.Errorf("enemies = %d before anyone left the safe zone, want 0", got)
	}
}

func TestEnemies_NoSpawnsInTheSafeZone(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	s, _ := join(t, hub, "a")
	snap, _ := latest(t, s, tick, 5*TickRate, 0, 180)

	if got := len(snap.GetEnemies()); got != 0 {
		t.Errorf("enemies = %d around a player at home, want 0", got)
	}
}

func TestEnemies_FireAtPlayersInRange(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	s, _ := join(t, hub, "a")
	_, messages := latest(t, s, tick, 15*TickRate, 1000, 0)

	var fired *pb.EnemyFired
	for _, msg := range messages {
		if f := msg.GetEnemyFired(); f != nil {
			fired = f

			break
		}
	}
	if fired == nil {
		t.Fatal("no enemy fired within 15 s")
	}
	toPlayer := math.Atan2(0-float64(fired.GetY()), 1000-float64(fired.GetX()))
	if diff := math.Abs(math.Remainder(float64(fired.GetAngle())-toPlayer, 2*math.Pi)); diff > 0.2 {
		t.Errorf("fired at angle %.2f, the player is at %.2f", fired.GetAngle(), toPlayer)
	}
}

func TestEnemies_HitsDestroyThem(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")
	b.Send(state(0, 180))
	snap, _ := latest(t, a, tick, 2*TickRate, 1000, 0)
	target := snap.GetEnemies()[0]
	// Catch b up to the same tick; the hub may still be sending it.
	caughtUp := false
	for !caughtUp {
		caughtUp = next(t, b).GetSnapshot().GetTick() == snap.GetTick()
	}

	hits := 0
	var destroyed *pb.EnemyDestroyed
	var after *pb.Snapshot
	for destroyed == nil && hits < 20 {
		hits++
		a.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_Hit{Hit: &pb.Hit{
			EnemyId: target.GetEnemyId(), ShotId: uint32(hits), Damage: 1,
		}}})
		// The hub handles the hit before it takes the next tick, so b's
		// messages up to that tick's snapshot include everything it caused.
		var messages []*pb.ServerMessage
		after, messages = latest(t, b, tick, 1, 0, 180)
		ended := false
		for _, msg := range messages {
			ended = ended || msg.GetShotEnded().GetShotId() == uint32(hits)
			if d := msg.GetEnemyDestroyed(); d != nil {
				destroyed = d
			}
		}
		if !ended {
			t.Fatalf("shot %d did not end for the other player", hits)
		}
	}

	want := 2
	if target.GetKind() == pb.EnemyKind_ENEMY_KIND_FIGHTER {
		want = 6
	}
	if got := hits; got != want {
		t.Errorf("destroyed after %d hits, want %d", got, want)
	}
	if got, want := destroyed.GetByPlayerId(), "a"; got != want {
		t.Errorf("destroyed by %q, want %q", got, want)
	}

	for _, e := range after.GetEnemies() {
		if e.GetEnemyId() == target.GetEnemyId() {
			t.Error("the destroyed enemy is still in the snapshot")
		}
	}
}

func TestEnemies_AnnounceVolleysAhead(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	s, _ := join(t, hub, "a")
	for range 15 * TickRate {
		snap, messages := latest(t, s, tick, 1, 1000, 0)
		for _, msg := range messages {
			fired := msg.GetEnemyFired()
			if fired == nil {
				continue
			}
			if got, want := fired.GetWarnTicks(), uint32(FireWarning); got != want {
				t.Errorf("warn ticks = %d, want %d", got, want)
			}
			// Sent in the step whose snapshot follows it.
			if got, want := fired.GetTick(), snap.GetTick()+FireWarning; got != want {
				t.Errorf("fires at tick %d, want %d (announced at %d)", got, want, snap.GetTick())
			}

			return
		}
	}
	t.Fatal("no enemy fired within 15 s")
}

func TestDamaged(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		hp     int
		damage uint32
		want   int
	}{
		{"a normal hit", 6, 1, 5},
		{"the cap itself", 20, MaxHitDamage, 20 - MaxHitDamage},
		{"a huge hit is capped", 100, 1_000_000, 100 - MaxHitDamage},
		{"the largest report is capped", 100, math.MaxUint32, 100 - MaxHitDamage},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			if got := Damaged(tc.hp, tc.damage); got != tc.want {
				t.Errorf("Damaged(%d, %d) = %d, want %d", tc.hp, tc.damage, got, tc.want)
			}
		})
	}
}

func TestEnemies_HitOnUnknownEnemyIsIgnored(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")
	a.Send(
		&pb.ClientMessage{
			Kind: &pb.ClientMessage_Hit{Hit: &pb.Hit{EnemyId: 999, ShotId: 1, Damage: 1}},
		},
	)
	tick(1)

	for {
		msg := next(t, b)
		if msg.GetShotEnded() != nil {
			t.Fatal("a hit on an unknown enemy ended a shot")
		}
		if msg.GetSnapshot() != nil {
			return
		}
	}
}
