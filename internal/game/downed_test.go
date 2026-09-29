package game_test

import (
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// companionDown flies a's stealthy companion out with a, parked at (0, 700),
// until enemy fire takes it down, and returns its state then.
func companionDown(t *testing.T, a *Session, tick func(int)) *pb.ShipState {
	t.Helper()

	a.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_SquadronOrder{SquadronOrder: &pb.SquadronOrder{
		Mode: pb.CompanionMode_COMPANION_MODE_STEALTH,
	}}})
	var down *pb.ShipState
	for range 120 * TickRate {
		snap, _ := latest(t, a, tick, 1, 0, 700)
		for _, p := range snap.GetPlayers() {
			if p.GetPlayerId() == "a/1" && p.GetState().GetDamage() >= sim.MaxDamage {
				down = p.GetState()
			}
		}
		if down != nil {
			return down
		}
	}
	t.Fatal("a/1 never went down in two minutes")

	return nil
}

func companion(snap *pb.Snapshot) *pb.ShipState {
	for _, p := range snap.GetPlayers() {
		if p.GetPlayerId() == "a/1" {
			return p.GetState()
		}
	}

	return nil
}

func TestDowned_ItsOwnerRevivesACompanion(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	grant(t, a)
	down := companionDown(t, a, tick)

	// a flies over beside it: a squadmate, so it's up within
	// ReviveSquadmateSeconds and some. Still under fire, it may go straight
	// back down within the same hub tick: its progress starting over counts.
	x, y := down.GetX()+20, down.GetY()
	progress := float32(0)
	for range int(2 * sim.ReviveSquadmateSeconds * TickRate) {
		snap, _ := latest(t, a, tick, 1, x, y)
		c := companion(snap)
		if c == nil {
			t.Fatal("a/1 left while down beside its owner")
		}
		up := c.GetDamage() < sim.MaxDamage
		if up && c.GetDamage() != sim.MaxDamage-1 {
			t.Errorf("revived a/1 at damage %d, want %d", c.GetDamage(), sim.MaxDamage-1)
		}
		if up || c.GetRevive() < progress-0.5 {
			return
		}
		progress = c.GetRevive()
	}
	t.Errorf("a/1 still down beside its owner, progress %v", progress)
}

func TestDowned_ALostCompanionGoesHome(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	grant(t, a)
	companionDown(t, a, tick)

	// a leaves it where it drifts, far enough that nobody revives it.
	for range int(sim.CompanionLostSeconds*TickRate) + TickRate {
		snap, messages := latest(t, a, tick, 1, 0, -1500)
		for _, msg := range messages {
			if d := msg.GetCompanionDismissed(); d != nil {
				if got, want := d.GetCompanion(), uint32(1); got != want {
					t.Errorf("dismissed companion %d, want %d", got, want)
				}
				if c := companion(snap); c != nil {
					t.Error("a/1 is still in snapshots after going home")
				}

				return
			}
		}
	}
	t.Errorf("a/1 down for %v s didn't go home", sim.CompanionLostSeconds)
}
