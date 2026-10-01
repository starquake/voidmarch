package game_test

import (
	"math"
	"slices"
	"testing"
	"time"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/world"
)

// eventMessages steps the hub n ticks with s's ship at (x, y), and returns
// the events that started and ended meanwhile, and the last snapshot.
func eventMessages(
	t *testing.T,
	s *Session,
	tick func(int),
	n int,
	x, y float32,
) (started []*pb.EventStarted, ended []*pb.EventEnded, snap *pb.Snapshot) {
	t.Helper()

	for range n {
		var others []*pb.ServerMessage
		snap, others = latest(t, s, tick, 1, x, y)
		for _, msg := range others {
			if e := msg.GetEventStarted(); e != nil {
				started = append(started, e)
			}
			if e := msg.GetEventEnded(); e != nil {
				ended = append(ended, e)
			}
		}
	}

	return started, ended, snap
}

func TestEvents_AnAttackComesToAClearedSectorOnSchedule(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(
		t,
		WithClearedSectors([]string{"E4"}),
		WithEventTimes(20, 200, 1<<30, 1<<30),
	)
	a, _ := join(t, hub, "a")
	started, _, snap := eventMessages(t, a, tick, 21, 0, 0)

	if len(started) != 1 {
		t.Fatalf("%d events started in 21 ticks, want 1", len(started))
	}
	e := started[0].GetEvent()
	if e.GetKind() != pb.WorldEventKind_WORLD_EVENT_KIND_ATTACK || e.GetSector() != "E4" {
		t.Errorf("event %+v, want an attack on E4, the one cleared sector", e)
	}
	if got, want := e.GetEndsTick(), snap.GetTick()+199; got < want-1 || got > want+1 {
		t.Errorf("ends at tick %d, want about %d", got, want)
	}
	if _, w := join(t, hub, "b"); w.GetWorldEvent().GetSector() != "E4" {
		t.Errorf("a joiner's world event = %+v, want the attack on E4", w.GetWorldEvent())
	}
}

func TestEvents_DefendingAnAttackKeepsTheSectorAndAddsAShip(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(
		t,
		WithClearedSectors([]string{"E4"}),
		WithPoolStart(3),
		WithEventTimes(1, 1<<20, 1<<30, 1<<30),
	)
	a, _ := join(t, hub, "a")
	var ended []*pb.EventEnded
	for i := range 60 * TickRate {
		_, end, snap := eventMessages(t, a, tick, 1, 1100, 0)
		ended = append(ended, end...)
		if len(ended) > 0 {
			break
		}
		for _, e := range snap.GetEnemies() {
			if e.GetKind() == pb.EnemyKind_ENEMY_KIND_FRIGATE {
				hitFrigate(a, e.GetEnemyId(), uint32(1000+i)) //nolint:gosec // few shots.
			}
		}
		killAll(a, snap)
	}

	if len(ended) != 1 || !ended[0].GetWon() {
		t.Fatalf("ended = %+v, want the attack won", ended)
	}
	if _, w := join(t, hub, "b"); !slices.Contains(w.GetClearedSectors(), "E4") {
		t.Errorf("cleared sectors = %v after defending E4, want it kept", w.GetClearedSectors())
	}
}

func TestEvents_AnAttackNobodyStopsTakesTheSector(t *testing.T) {
	t.Parallel()

	forgotten := make(chan string, 1)
	hub, tick := testHub(t,
		WithClearedSectors([]string{"E4"}),
		WithEventTimes(1, 20, 1<<30, 1<<30),
		WithForgetSector(func(name string) { forgotten <- name }),
	)
	a, _ := join(t, hub, "a")
	_, ended, _ := eventMessages(t, a, tick, 25, 0, 0)

	if len(ended) != 1 || ended[0].GetWon() || ended[0].GetEvent().GetSector() != "E4" {
		t.Fatalf("ended = %+v, want the attack on E4 lost", ended)
	}
	select {
	case name := <-forgotten:
		if name != "E4" {
			t.Errorf("forgot %q, want E4", name)
		}
	case <-time.After(time.Second):
		t.Fatal("the lost sector was not saved as hostile")
	}
	if _, w := join(t, hub, "b"); slices.Contains(w.GetClearedSectors(), "E4") {
		t.Errorf("cleared sectors = %v, want E4 gone", w.GetClearedSectors())
	}
	if snap, _ := latest(t, a, tick, 1, 1000, 0); inE4(snap) == 0 {
		t.Error("no garrison took the field in E4 after it fell")
	}
}

func TestEvents_WithNobodyOnlineAnAttackComesEveryFewHours(t *testing.T) {
	t.Parallel()

	forgotten := make(chan string, 1)
	hub, tick := testHub(t,
		WithClearedSectors([]string{"E4"}),
		WithEventTimes(1<<30, 1<<30, 40, 30),
		WithForgetSector(func(name string) { forgotten <- name }),
	)
	tick(30 + 40 + 2)
	select {
	case name := <-forgotten:
		if name != "E4" {
			t.Errorf("forgot %q, want E4", name)
		}
	case <-time.After(time.Second):
		t.Fatal("no attack took a sector while nobody was online")
	}
	if _, w := join(t, hub, "a"); len(w.GetClearedSectors()) != 0 {
		t.Errorf("cleared sectors = %v, want none left", w.GetClearedSectors())
	}
}

func TestEvents_ADistressCallIsWonByTheRescue(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithPoolStart(3), WithEventTimes(1, 1<<30, 1<<30, 1<<30))
	a, _ := join(t, hub, "a")
	started, _, snap := eventMessages(t, a, tick, 2, 0, 0)
	if len(started) != 1 ||
		started[0].GetEvent().GetKind() != pb.WorldEventKind_WORLD_EVENT_KIND_DISTRESS {
		t.Fatalf("started = %+v, want a distress call: nothing is cleared to attack", started)
	}
	if len(snap.GetDerelicts()) != 1 {
		t.Fatalf("%d derelicts, want the distress call's", len(snap.GetDerelicts()))
	}
	d := snap.GetDerelicts()[0]
	if math.Abs(float64(d.GetX())) > 1600 || math.Abs(float64(d.GetY())) > 1600 {
		t.Errorf("derelict at (%v, %v), want it in a sector next to home", d.GetX(), d.GetY())
	}

	_, ended, _ := eventMessages(t, a, tick, rescueTicks+2, d.GetX()+40, d.GetY())
	if len(ended) != 1 || !ended[0].GetWon() {
		t.Errorf("ended = %+v, want the distress call won by the rescue", ended)
	}
}

func TestEvents_ADistressCallIsLostWhenTheDerelictDriftsOff(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithPoolStart(3), WithEventTimes(1, 1<<30, 1<<30, 1<<30))
	a, _ := join(t, hub, "a")
	_, ended, _ := eventMessages(t, a, tick, int(DerelictTicks)+3, 0, 0)
	if len(ended) == 0 || ended[0].GetWon() {
		t.Errorf("ended = %+v, want the distress call lost", ended)
	}
}

func TestEvents_AMapCanKeepThemAway(t *testing.T) {
	t.Parallel()

	m := &world.Map{Name: "test", NoEvents: true}
	hub, tick := testHub(t, WithMap(m), WithClearedSectors([]string{"E4"}))
	a, _ := join(t, hub, "a")
	tick(EventEvery + 2)
	if _, w := join(t, hub, "b"); w.GetWorldEvent() != nil {
		t.Errorf("world event = %+v on a map without events", w.GetWorldEvent())
	}
	drain(a)
}

func TestEvents_ADevelopmentServerStartsAnAttackOnRequest(t *testing.T) {
	t.Parallel()

	start := &pb.ClientMessage{
		Kind: &pb.ClientMessage_DevStartAttack{DevStartAttack: &pb.DevStartAttack{Sector: "E4"}},
	}
	for _, dev := range []bool{true, false} {
		opts := []HubOption{WithClearedSectors([]string{"E4"}), NoEvents}
		if dev {
			opts = append(opts, WithDevelopment())
		}
		hub, tick := testHub(t, opts...)
		a, _ := join(t, hub, "a")
		a.Send(start)
		if started, _, _ := eventMessages(t, a, tick, 1, 0, 0); (len(started) == 1) != dev {
			t.Errorf("development %t: %d attacks started on request", dev, len(started))
		}
	}
}
