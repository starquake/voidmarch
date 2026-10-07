package game_test

import (
	"slices"
	"testing"
	"time"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
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
	if snap, _ := latest(t, a, tick, 1, enterX, enterY); inE4(snap) == 0 {
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

func TestEvents_ADistressCallIsWonByTheRescueOnceItsGuardIsGone(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(
		t,
		WithEveryEnemy(),
		WithPoolStart(3),
		WithEventTimes(1, 1<<30, 1<<30, 1<<30),
	)
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
	if s, ok := sim.SectorAt(float64(d.GetX()), float64(d.GetY())); !ok || s.Ring() != 1 {
		t.Errorf("derelict at (%v, %v), want it in a sector next to home", d.GetX(), d.GetY())
	}
	if !d.GetHeld() {
		t.Error("the distress call's derelict isn't held by its guard")
	}

	killAll(a, snap)
	started, _, snap = eventMessages(t, a, tick, 2, 0, 0)
	if len(started) != 1 || !started[0].GetOngoing() ||
		started[0].GetEvent().GetEndsTick() != snap.GetDerelicts()[0].GetGoneTick() {
		t.Errorf(
			"started = %+v once the guard was gone, want the call to end with the freed derelict",
			started,
		)
	}

	_, ended, _ := eventMessages(t, a, tick, rescueTicks+2, d.GetX()+40, d.GetY())
	if len(ended) != 1 || !ended[0].GetWon() {
		t.Errorf("ended = %+v, want the distress call won by the rescue", ended)
	}
}

func TestEvents_ADistressCallStillHeldWhenTimeIsUpIsLost(t *testing.T) {
	t.Parallel()

	const lasts = 50
	hub, tick := testHub(t, WithPoolStart(3), WithEventTimes(1, lasts, 1<<30, 1<<30))
	a, _ := join(t, hub, "a")
	_, _, snap := eventMessages(t, a, tick, 2, 0, 0)
	held := snap.GetDerelicts()[0].GetDerelictId()
	_, ended, snap := eventMessages(t, a, tick, lasts+1, 0, 0)
	if len(ended) == 0 || ended[0].GetWon() {
		t.Errorf("ended = %+v, want the distress call lost", ended)
	}
	for _, d := range snap.GetDerelicts() {
		if d.GetDerelictId() == held {
			t.Errorf("derelict %d is still there after its call was lost", held)
		}
	}
}

func TestEvents_ADistressCallIsLostWhenTheFreedDerelictDriftsOff(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(
		t,
		WithEveryEnemy(),
		WithPoolStart(3),
		WithEventTimes(1, 1<<30, 1<<30, 1<<30),
	)
	a, _ := join(t, hub, "a")
	_, _, snap := eventMessages(t, a, tick, 2, 0, 0)
	killAll(a, snap)
	_, ended, _ := eventMessages(t, a, tick, int(DerelictTicks)+3, 0, 0)
	if len(ended) != 1 || ended[0].GetWon() {
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

// devAttack is K on a development server, in sector.
func devAttack(sector string) *pb.ClientMessage {
	return &pb.ClientMessage{
		Kind: &pb.ClientMessage_DevStartAttack{DevStartAttack: &pb.DevStartAttack{Sector: sector}},
	}
}

func TestEvents_ADevelopmentServerStartsAnAttackOnRequest(t *testing.T) {
	t.Parallel()

	for _, dev := range []bool{true, false} {
		opts := []HubOption{WithClearedSectors([]string{"E4"}), NoEvents}
		if dev {
			opts = append(opts, WithDevelopment())
		}
		hub, tick := testHub(t, opts...)
		a, _ := join(t, hub, "a")
		a.Send(devAttack("E4"))
		if started, _, _ := eventMessages(t, a, tick, 1, 0, 0); (len(started) == 1) != dev {
			t.Errorf("development %t: %d attacks started on request", dev, len(started))
		}
	}
}

func TestEvents_ADevelopmentServerMovesARunningAttackOnRequest(t *testing.T) {
	t.Parallel()

	e4, _ := sim.ParseSector("E4")
	frigatesInE4 := func(snap *pb.Snapshot) int {
		n := 0
		for _, e := range snap.GetEnemies() {
			if e.GetKind() == pb.EnemyKind_ENEMY_KIND_FRIGATE &&
				e4.Contains(float64(e.GetX()), float64(e.GetY())) {
				n++
			}
		}

		return n
	}
	hub, tick := testHub(t, WithDevelopment(), WithClearedSectors([]string{"E4", "C4"}), NoEvents)
	a, _ := join(t, hub, "a")
	a.Send(devAttack("E4"))
	started, _, snap := eventMessages(t, a, tick, 1, 0, 0)
	if len(started) != 1 || frigatesInE4(snap) != 1 {
		t.Fatalf(
			"started = %+v with %d Frigates in E4, want one attacking",
			started,
			frigatesInE4(snap),
		)
	}

	a.Send(devAttack("C4"))
	started, ended, snap := eventMessages(t, a, tick, 2, 0, 0)

	if len(started) != 1 || started[0].GetEvent().GetSector() != "C4" {
		t.Errorf("started = %+v, want the attack moved to C4", started)
	}
	// An attack's end tells clients its sector fell or held; this one did neither.
	if len(ended) != 0 {
		t.Errorf("ended = %+v, want none", ended)
	}
	if n := frigatesInE4(snap); n != 0 {
		t.Errorf("%d Frigates in E4 after its attack moved, want 0", n)
	}
	_, w := join(t, hub, "b")
	if got := w.GetWorldEvent().GetSector(); got != "C4" {
		t.Errorf("world event in %q for a new player, want C4", got)
	}
	if got := w.GetClearedSectors(); !slices.Contains(got, "E4") || !slices.Contains(got, "C4") {
		t.Errorf("cleared sectors = %v, want E4 and C4 kept", got)
	}
}

func TestEvents_ADevelopmentServerAttacksInPlaceOfADistressCall(t *testing.T) {
	t.Parallel()

	all := make([]string, 0, len(sim.Sectors()))
	for _, s := range sim.Sectors() {
		all = append(all, s.Name())
	}
	// With nothing hostile left to attack from, the event on schedule is a distress call.
	hub, tick := testHub(t,
		WithDevelopment(),
		WithPoolStart(3),
		WithClearedSectors(all),
		WithEventTimes(1, 1<<30, 1<<30, 1<<30),
	)
	a, _ := join(t, hub, "a")
	started, _, snap := eventMessages(t, a, tick, 2, 0, 0)
	if len(started) != 1 ||
		started[0].GetEvent().GetKind() != pb.WorldEventKind_WORLD_EVENT_KIND_DISTRESS ||
		len(snap.GetDerelicts()) != 1 {
		t.Fatalf(
			"started = %+v with %d derelicts, want a distress call",
			started,
			len(snap.GetDerelicts()),
		)
	}
	held := snap.GetDerelicts()[0].GetDerelictId()

	a.Send(devAttack("E4"))
	started, ended, snap := eventMessages(t, a, tick, 2, 0, 0)

	if len(started) != 1 ||
		started[0].GetEvent().GetKind() != pb.WorldEventKind_WORLD_EVENT_KIND_ATTACK {
		t.Errorf("started = %+v, want an attack on E4", started)
	}
	if len(ended) != 0 {
		t.Errorf("ended = %+v, want none", ended)
	}
	for _, d := range snap.GetDerelicts() {
		if d.GetDerelictId() == held {
			t.Errorf("derelict %d is still there after its call was replaced", held)
		}
	}
}
