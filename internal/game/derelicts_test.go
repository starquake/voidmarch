package game_test

import (
	"cmp"
	"context"
	"log/slog"
	"math"
	"slices"
	"testing"
	"time"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
	"github.com/starquake/voidmarch/internal/world"
)

// rescueTicks is how many hub ticks a rescue takes, with one to spare.
const rescueTicks = int(sim.ReviveSeconds*TickRate) + 1

// hitAll reports a hit of the most damage a shot does on each of enemies,
// with shot ids from first.
func hitAll(s *Session, enemies []*pb.EnemyState, first uint32) {
	for i, e := range enemies {
		hitFrigate(s, e.GetEnemyId(), first+uint32(i)) //nolint:gosec // few enemies.
	}
}

// heldBeside is the snapshot's one derelict, which on the frigateMap (no
// derelict spots) is its Frigate's, or nil.
func heldBeside(snap *pb.Snapshot) *pb.DerelictState {
	if d := snap.GetDerelicts(); len(d) == 1 {
		return d[0]
	}

	return nil
}

func TestDerelicts_AFrigateHoldsOneBesideItUntilItsFleetIsGone(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithEveryEnemy(), WithMap(frigateMap), WithPoolStart(3), NoEvents)
	a, _ := join(t, hub, "a")
	snap := must(latest(t, a, tick, 1, 0, 0))
	d := heldBeside(snap)
	if d == nil || !d.GetHeld() || d.GetGoneTick() != math.MaxUint32 {
		t.Fatalf(
			"derelicts %+v, want one held beside the Frigate, its time not running",
			snap.GetDerelicts(),
		)
	}

	f := frigateIn(snap)
	for shot := range uint32(10) {
		hitFrigate(a, f.GetEnemyId(), shot+1)
	}
	if d = heldBeside(must(latest(t, a, tick, 1, 0, 0))); d == nil || !d.GetHeld() {
		t.Fatalf("derelict %+v with the Frigate down and its escorts up, want it still held", d)
	}

	hitAll(a, must(latest(t, a, tick, 1, 0, 0)).GetEnemies(), 100)
	snap = must(latest(t, a, tick, 1, 0, 0))
	d = heldBeside(snap)
	if d == nil || d.GetHeld() {
		t.Fatalf("derelict %+v with no enemy near, want it freed", d)
	}
	if got, want := d.GetGoneTick(), snap.GetTick()+DerelictTicks; got != want {
		t.Errorf("gone at tick %d once freed, want %d", got, want)
	}
}

func TestDerelicts_AHeldOneCantBeRescued(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithMap(frigateMap), WithPoolStart(3))
	a, _ := join(t, hub, "a")
	d := heldBeside(must(latest(t, a, tick, 1, 0, 0)))
	if d == nil {
		t.Fatal("no derelict beside the Frigate")
	}
	snap, others := latest(t, a, tick, rescueTicks, d.GetX(), d.GetY()+40)
	if d = heldBeside(snap); d == nil || d.GetRescue() != 0 {
		t.Errorf("held derelict %+v after hovering beside it, want no rescue", d)
	}
	for _, msg := range others {
		if msg.GetDerelictRescued() != nil {
			t.Fatal("a held derelict was rescued")
		}
	}
}

func TestDerelicts_OnePerFrigateSpot(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithMap(frigateMap), WithPoolStart(3), NoEvents)
	a, _ := join(t, hub, "a")
	f := frigateIn(must(latest(t, a, tick, 1, 0, 0)))
	for shot := range uint32(10) {
		hitFrigate(a, f.GetEnemyId(), shot+1)
	}
	snap := must(latest(t, a, tick, FrigateRespawnTicks+2, 0, 0))
	if frigateIn(snap) == nil {
		t.Fatal("the Frigate didn't come back")
	}
	if n := len(snap.GetDerelicts()); n != 1 {
		t.Errorf("%d derelicts after the Frigate came back to its waiting one, want 1", n)
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
	if rescued.GetPlayerId() != "a" || rescued.GetHangar() != 4 || !rescued.GetDocked() {
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

func TestDerelicts_AFullFleetStillGetsThemButDocksNone(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithDerelictAt(0, -600), WithPoolStart(sim.MaxFleet))
	a, _ := join(t, hub, "a")
	if snap, _ := latest(t, a, tick, 1, 0, 0); len(snap.GetDerelicts()) != 1 {
		t.Fatalf("%d derelicts with a full fleet, want the one released", len(snap.GetDerelicts()))
	}
	for range rescueTicks + 1 {
		_, others := latest(t, a, tick, 1, 60, -600)
		for _, msg := range others {
			if r := msg.GetDerelictRescued(); r != nil {
				if r.GetDocked() || r.GetHangar() != sim.MaxFleet {
					t.Errorf("rescued %+v with a full fleet, want it counted but not docked", r)
				}

				return
			}
		}
	}
	t.Error("the derelict was never rescued")
}

func TestDerelicts_AMapSpotAlwaysHasOneWaiting(t *testing.T) {
	t.Parallel()

	m := &world.Map{Name: "test", Derelicts: []world.Spot{{X: 0, Y: -600}}}
	hub, tick := testHub(t, WithMap(m), WithPoolStart(3))
	a, _ := join(t, hub, "a")
	first := must(latest(t, a, tick, 1, 0, 0)).GetDerelicts()
	if len(first) != 1 || first[0].GetX() != 0 || first[0].GetY() != -600 {
		t.Fatalf("derelicts at the start = %+v, want one at the map's spot", first)
	}

	var again []*pb.DerelictState
	for range rescueTicks + 1 {
		again = must(latest(t, a, tick, 1, 60, -600)).GetDerelicts()
	}
	if len(again) != 1 || again[0].GetDerelictId() == first[0].GetDerelictId() {
		t.Errorf("derelicts after the rescue = %+v, want a new one at the spot", again)
	}
}

func TestDerelicts_ARescueSavesTheBiggerFleet(t *testing.T) {
	t.Parallel()

	saves := &fleetSaves{}
	ctx, cancel := context.WithCancel(t.Context())
	ticks := make(chan time.Time)
	hub := NewHub(
		slog.New(slog.DiscardHandler),
		WithSeed(1),
		WithPoolStart(3),
		WithSaveFleet(saves.save),
		WithDerelictAt(0, -600),
	)
	done := make(chan struct{})
	go func() {
		hub.Run(ctx, ticks)
		close(done)
	}()

	a, _ := join(t, hub, "a")
	for range rescueTicks + 1 {
		a.Send(state(60, -600))
		ticks <- time.Time{}
		drain(a)
	}
	cancel()
	<-done

	if got, want := saves.all(), []int{3, 4}; !slices.Equal(got, want) {
		t.Errorf("saved fleets = %v, want %v", got, want)
	}
}
