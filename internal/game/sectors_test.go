package game_test

import (
	"cmp"
	"math"
	"slices"
	"testing"
	"time"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
	"github.com/starquake/voidmarch/internal/world"
)

func TestSectors_AJoinerIsToldTheClearedOnes(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t, WithClearedSectors([]string{"E3", "C3", "Z9"}))
	_, w := join(t, hub, "a")

	if got, want := w.GetClearedSectors(), []string{"C3", "E3"}; !slices.Equal(got, want) {
		t.Errorf("ClearedSectors = %v, want %v: sorted, and off-grid names dropped", got, want)
	}
}

// killAll has s destroy every enemy in snap, one strong hit each.
func killAll(s *Session, snap *pb.Snapshot) {
	for i, e := range snap.GetEnemies() {
		s.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_Hit{Hit: &pb.Hit{
			EnemyId: e.GetEnemyId(),
			ShotId:  uint32(i + 1),
			Damage:  MaxHitDamage, //nolint:gosec // few enemies.
		}}})
	}
}

// towardE4 is the point d along the line from home's center to E4's, the
// sector down and right of it: home's edge is 857 along, E4's center 1,715.
func towardE4(d float64) (x, y float32) {
	return float32(d * math.Sqrt(3) / 2), float32(d / 2)
}

// Points on the way to E4: its center, inside its edge with home, just short
// of that edge, and in home.
var (
	e4X, e4Y       = towardE4(2 * sim.SectorApothem)
	enterX, enterY = towardE4(1000)
	edgeX, edgeY   = towardE4(837)
	nearX, nearY   = towardE4(600)
)

// inE4 is how many of snap's enemies are in E4, the sector down and right of home.
func inE4(snap *pb.Snapshot) int {
	e4, _ := sim.ParseSector("E4")
	n := 0
	for _, e := range snap.GetEnemies() {
		if e4.Contains(float64(e.GetX()), float64(e.GetY())) {
			n++
		}
	}

	return n
}

func TestGarrison_TakesTheFieldAroundItsSectorsCenter(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := join(t, hub, "a")
	snap, _ := latest(t, a, tick, 1, enterX, enterY)

	if got, want := len(snap.GetEnemies()), sim.GarrisonSize(1); got != want {
		t.Fatalf("%d enemies once a player entered E4, want its garrison of %d", got, want)
	}
	for _, e := range snap.GetEnemies() {
		if d := math.Hypot(float64(e.GetX()-e4X), float64(e.GetY()-e4Y)); d > GarrisonPosts+10 {
			t.Errorf("enemy %d took the field %.0f px from E4's center", e.GetEnemyId(), d)
		}
	}
}

func TestGarrison_GrowsWithTheShipsThatEnter(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")
	b.Send(state(enterX, enterY+50))
	snap, _ := latest(t, a, tick, 1, enterX, enterY)

	if got, want := inE4(snap), sim.GarrisonSize(1)*3/2; got != want {
		t.Errorf("%d enemies for two players, want half again the base, %d", got, want)
	}
}

func TestGarrison_HoldsItsSectorAndGoesBackToItsPosts(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := join(t, hub, "a")
	e4, _ := sim.ParseSector("E4")
	var snap *pb.Snapshot
	for range 10 * TickRate {
		snap, _ = latest(t, a, tick, 1, edgeX, edgeY)
		for _, e := range snap.GetEnemies() {
			// A bump from the player can push one a little over the edge.
			if d := e4.Beyond(float64(e.GetX()), float64(e.GetY())); d > sim.ShipRadius*2 {
				t.Fatalf(
					"enemy %d is %.0f px out of E4 chasing a player at its edge",
					e.GetEnemyId(),
					d,
				)
			}
		}
	}
	snap, _ = latest(t, a, tick, 10*TickRate, nearX, nearY)
	for _, e := range snap.GetEnemies() {
		if d := math.Hypot(float64(e.GetX()-e4X), float64(e.GetY()-e4Y)); d > GarrisonPosts+60 {
			t.Errorf(
				"enemy %d is %.0f px from E4's center after the player left",
				e.GetEnemyId(),
				d,
			)
		}
	}
}

func TestGarrison_StandsDownWithNobodyNearAndKeepsItsLosses(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := join(t, hub, "a")
	snap, _ := latest(t, a, tick, 1, enterX, enterY)
	two := &pb.Snapshot{Enemies: snap.GetEnemies()[:2]}
	killAll(a, two)
	latest(t, a, tick, 1, enterX, enterY)

	snap, _ = latest(t, a, tick, GarrisonIdle+2, -2000, -2000)
	if n := inE4(snap); n != 0 {
		t.Errorf("%d enemies still in E4 long after everyone left", n)
	}
	snap, _ = latest(t, a, tick, 1, enterX, enterY)
	if got, want := inE4(snap), sim.GarrisonSize(1)-2; got != want {
		t.Errorf("%d enemies back in E4, want the garrison less its losses, %d", got, want)
	}
}

func TestGarrison_ClearingASectorSavesItAndTellsEveryone(t *testing.T) {
	t.Parallel()

	saved := make(chan string, 1)
	m := &world.Map{Name: "test", Garrisons: map[string]int{"E4": 2}}
	hub, tick := testHub(t, WithMap(m), WithSaveSector(func(name string) { saved <- name }))
	a, _ := join(t, hub, "a")
	snap, _ := latest(t, a, tick, 1, enterX, enterY)
	killAll(a, snap)
	_, others := latest(t, a, tick, 1, enterX, enterY)

	var cleared *pb.SectorCleared
	for _, msg := range others {
		cleared = cmp.Or(msg.GetSectorCleared(), cleared)
	}
	if cleared.GetSector() != "E4" {
		t.Errorf("SectorCleared = %+v, want E4", cleared)
	}
	select {
	case name := <-saved:
		if name != "E4" {
			t.Errorf("saved %q, want E4", name)
		}
	case <-time.After(time.Second):
		t.Error("the cleared sector was not saved")
	}
	if _, w := join(t, hub, "b"); !slices.Contains(w.GetClearedSectors(), "E4") {
		t.Errorf("a joiner's cleared sectors = %v, want E4 among them", w.GetClearedSectors())
	}
	if snap, _ = latest(t, a, tick, TickRate, e4X, e4Y); inE4(snap) != 0 {
		t.Errorf("%d enemies in E4 after it was cleared", inE4(snap))
	}
}

func TestGarrison_ABossSectorNeedsItsFrigateDown(t *testing.T) {
	t.Parallel()

	m := &world.Map{
		Name:      "test",
		Bosses:    []world.Boss{{Kind: "frigate", Sector: "D3"}},
		Garrisons: map[string]int{"D3": 1},
	}
	hub, tick := testHub(t, WithMap(m), NoEvents)
	a, _ := join(t, hub, "a")
	snap, _ := latest(t, a, tick, 1, 0, -1000)
	frigate := frigateIn(snap)
	// The garrison and the Frigate's escort: everything but the Frigate.
	rest := slices.DeleteFunc(slices.Clone(snap.GetEnemies()), func(e *pb.EnemyState) bool {
		return e.GetEnemyId() == frigate.GetEnemyId()
	})
	killAll(a, &pb.Snapshot{Enemies: rest})
	_, others := latest(t, a, tick, 1, 0, -1000)
	for _, msg := range others {
		if msg.GetSectorCleared() != nil {
			t.Fatal("D3 cleared with its Frigate still up")
		}
	}

	for shot := range uint32(10) {
		hitFrigate(a, frigate.GetEnemyId(), shot+100)
	}
	var cleared *pb.SectorCleared
	for cleared == nil {
		cleared = next(t, a).GetSectorCleared()
	}
	if cleared.GetSector() != "D3" {
		t.Errorf("cleared %s, want D3", cleared.GetSector())
	}
	if f := frigateIn(must(latest(t, a, tick, FrigateRespawnTicks+1, 0, -1000))); f != nil {
		t.Error("the Frigate came back to a cleared sector")
	}
}

func TestGarrison_HomeIsQuiet(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := join(t, hub, "a")
	home := sim.HomeSector()
	for range 5 * TickRate {
		snap, _ := latest(t, a, tick, 1, 0, 600)
		for _, e := range snap.GetEnemies() {
			if home.Contains(float64(e.GetX()), float64(e.GetY())) {
				t.Fatalf("enemy %d in the home sector", e.GetEnemyId())
			}
		}
	}
}

func TestGarrison_AClearedSectorGetsTheOddStraggler(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithClearedSectors([]string{"E4"}))
	a, _ := join(t, hub, "a")
	snap, _ := latest(t, a, tick, StragglerTicks, e4X, e4Y)
	if n := len(snap.GetEnemies()); n != 0 {
		t.Fatalf("%d enemies in the first minute in a cleared sector, want none", n)
	}
	snap, _ = latest(t, a, tick, 2, e4X, e4Y)
	enemies := snap.GetEnemies()
	if len(enemies) != 1 || enemies[0].GetKind() != pb.EnemyKind_ENEMY_KIND_SCOUT {
		t.Errorf("enemies after a minute = %+v, want one Scout", snap.GetEnemies())
	}
}

func TestGarrison_TheMapCapsHowManyFightAtOnce(t *testing.T) {
	t.Parallel()

	m := &world.Map{Name: "test", Field: 3, Garrisons: map[string]int{"E4": 50}}
	hub, tick := testHub(t, WithMap(m))
	a, _ := join(t, hub, "a")
	snap, _ := latest(t, a, tick, 1, enterX, enterY)
	if got := inE4(snap); got != 3 {
		t.Errorf("%d of a garrison of 50 on the field, want the map's 3", got)
	}
	killAll(a, snap)
	snap, _ = latest(t, a, tick, 2, enterX, enterY)
	if got := inE4(snap); got != 3 {
		t.Errorf("%d on the field after 3 fell, want 3 more in their place", got)
	}
}
