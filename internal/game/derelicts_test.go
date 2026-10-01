package game_test

import (
	"cmp"
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// rescueTicks is how many hub ticks a rescue takes, with one to spare.
const rescueTicks = int(sim.ReviveSeconds*TickRate) + 1

func TestDerelicts_AFrigateReleasesOneWhereItWentDown(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithMap(frigateMap), WithPoolStart(3))
	a, _ := join(t, hub, "a")
	f := frigateIn(must(latest(t, a, tick, 1, 0, -400)))
	for shot := range uint32(10) {
		hitFrigate(a, f.GetEnemyId(), shot+1)
	}
	snap, _ := latest(t, a, tick, 1, 0, -400)

	derelicts := snap.GetDerelicts()
	if len(derelicts) != 1 {
		t.Fatalf("%d derelicts after the Frigate went down, want 1", len(derelicts))
	}
	d := derelicts[0]
	if d.GetX() != f.GetX() || d.GetY() != f.GetY() || d.GetRescue() != 0 {
		t.Errorf(
			"derelict %+v, want one at the Frigate's (%v, %v), not yet rescued",
			d,
			f.GetX(),
			f.GetY(),
		)
	}
	if got, want := d.GetGoneTick(), snap.GetTick()-1+DerelictTicks; got != want {
		t.Errorf("gone at tick %d, want %d", got, want)
	}
}

func TestDerelicts_APlayerHoveringBesideRescuesIt(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithDerelictAt(0, -600), WithPoolStart(3))
	a, _ := join(t, hub, "a")
	snap, _ := latest(t, a, tick, rescueTicks/2, 60, -600)
	if got := snap.GetDerelicts()[0].GetRescue(); got < 0.4 || got > 0.6 {
		t.Errorf("rescue halfway = %v, want about 0.5", got)
	}

	var rescued *pb.DerelictRescued
	var hangar *pb.Squadrons
	for range rescueTicks {
		var others []*pb.ServerMessage
		snap, others = latest(t, a, tick, 1, 60, -600)
		for _, msg := range others {
			rescued = cmp.Or(msg.GetDerelictRescued(), rescued)
			hangar = cmp.Or(msg.GetSquadrons(), hangar)
		}
		if rescued != nil {
			break
		}
	}
	if rescued.GetPlayerId() != "a" || rescued.GetHangar() != 4 {
		t.Errorf("rescued %+v, want by a, with 4 ships in the hangar", rescued)
	}
	if got := hangar.GetHangar(); got != 4 {
		t.Errorf("Squadrons hangar = %d, want 4", got)
	}
	if len(snap.GetDerelicts()) != 0 {
		t.Errorf("%d derelicts after the rescue, want 0", len(snap.GetDerelicts()))
	}
}

func TestDerelicts_TheRescueDrainsWithNobodyNear(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithDerelictAt(0, -600), WithPoolStart(3))
	a, _ := join(t, hub, "a")
	latest(t, a, tick, rescueTicks/2, 60, -600)
	snap, _ := latest(t, a, tick, rescueTicks, 400, -600)

	if got := snap.GetDerelicts()[0].GetRescue(); got != 0 {
		t.Errorf("rescue after leaving it = %v, want drained to 0", got)
	}
}

func TestDerelicts_ACompanionRescuesItForItsOwner(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithDerelictAt(250, 0), WithPoolStart(3))
	a, _ := pilot(t, hub, "a")
	must(latest(t, a, tick, 1, 0, 0))
	grant(t, a)
	for range 20 * TickRate {
		_, others := latest(t, a, tick, 1, 0, 0)
		for _, msg := range others {
			if r := msg.GetDerelictRescued(); r != nil {
				if r.GetPlayerId() != "a" {
					t.Errorf("rescued by %q, want the companion's owner a", r.GetPlayerId())
				}

				return
			}
		}
	}
	t.Error("the companion never rescued the derelict 250 px from its owner")
}

func TestDerelicts_GoneWhenTheirTimeIsUp(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithDerelictAt(0, -600), WithPoolStart(3))
	tick(int(DerelictTicks) - 2)
	a, _ := join(t, hub, "a")
	if snap, _ := latest(t, a, tick, 1, 0, 0); len(snap.GetDerelicts()) != 1 {
		t.Error("the derelict is gone before its time")
	}
	if snap, _ := latest(t, a, tick, 1, 0, 0); len(snap.GetDerelicts()) != 0 {
		t.Error("the derelict is still there after its time")
	}
}

func TestDerelicts_NoneWhileTheFleetIsFull(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithDerelictAt(0, -600), WithPoolStart(sim.MaxFleet))
	a, _ := join(t, hub, "a")
	if snap, _ := latest(t, a, tick, 1, 0, 0); len(snap.GetDerelicts()) != 0 {
		t.Errorf("%d derelicts with a full fleet, want 0", len(snap.GetDerelicts()))
	}
}
