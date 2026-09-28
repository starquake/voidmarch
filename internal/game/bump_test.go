package game_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// moving is a ship state at (x, y) moving at (vx, vy).
func moving(x, y, vx, vy float32) *pb.ClientMessage {
	return &pb.ClientMessage{
		Kind: &pb.ClientMessage_State{State: &pb.ShipState{X: x, Y: y, Vx: vx, Vy: vy}},
	}
}

func TestBump_ACompanionLeavesItsOwnersShip(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	grant(t, a)

	c := snapshotPlayers(t, a, tick)["a/1"].GetState()
	if d := math.Hypot(float64(c.GetX()), float64(c.GetY())-180); d < 2*sim.ShipRadius-1e-3 {
		t.Errorf("a/1 %v from a, want at least %v: out of its owner's ship", d, 2*sim.ShipRadius)
	}
}

func TestBump_APlayerRammingACompanionHurtsIt(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	grant(t, a)
	c := snapshotPlayers(t, a, tick)["a/1"].GetState()

	// a rushes into its companion from beside it.
	x, y := c.GetX()-2*sim.ShipRadius+4, c.GetY()
	a.Send(moving(x, y, 3*float32(sim.RammingSpeed), 0))
	hurt := snapshotPlayers(t, a, tick)["a/1"].GetState()
	if hurt.GetShield() >= c.GetShield() && hurt.GetDamage() <= c.GetDamage() {
		t.Errorf(
			"a/1 after the ram: shield %v, damage %v; want less shield or more damage than %v, %v",
			hurt.GetShield(), hurt.GetDamage(), c.GetShield(), c.GetDamage(),
		)
	}
}

func TestBump_EnemiesLeavePlayersShips(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithEnemyAt(0, 700))
	a, _ := pilot(t, hub, "a")
	snap, _ := latest(t, a, tick, 2, 0, 700)
	for _, e := range snap.GetEnemies() {
		if e.GetEnemyId() != 1 {
			continue
		}
		reach := sim.ShipRadius + sim.EnemyRadius(sim.EnemyScout)
		if e.GetKind() == pb.EnemyKind_ENEMY_KIND_FIGHTER {
			reach = sim.ShipRadius + sim.EnemyRadius(sim.EnemyFighter)
		}
		if d := math.Hypot(float64(e.GetX()), float64(e.GetY())-700); d < reach-1e-3 {
			t.Errorf("enemy 1 %v from a, want at least %v: out of a's ship", d, reach)
		}

		return
	}
	t.Fatalf("enemies = %v, want enemy 1 near a", snap.GetEnemies())
}

func TestBump_ARamHitHasNoShotToEnd(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithEnemyAt(0, 700))
	a, _ := pilot(t, hub, "a")
	b, _ := pilot(t, hub, "b")
	latest(t, a, tick, 1, 0, 700)
	// Enough rams for a Fighter, the tougher kind.
	for range 3 {
		a.Send(
			&pb.ClientMessage{
				Kind: &pb.ClientMessage_Hit{Hit: &pb.Hit{EnemyId: 1, Damage: sim.RammingDamage}},
			},
		)
	}
	_, messages := latest(t, b, tick, 2, 0, 180)
	var destroyed bool
	for _, msg := range messages {
		if msg.GetShotEnded() != nil {
			t.Errorf("shot ended = %v, want none for a ram", msg.GetShotEnded())
		}
		destroyed = destroyed || msg.GetEnemyDestroyed().GetEnemyId() == 1
	}
	if !destroyed {
		t.Error("three rams didn't destroy the enemy; want them to count")
	}
}
