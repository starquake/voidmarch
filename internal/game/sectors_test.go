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

func TestWelcome_NamesTheMap(t *testing.T) {
	t.Parallel()

	m := &world.Map{Name: "frontier"}
	hub, _ := testHub(t, WithMap(m))
	if _, w := join(t, hub, "a"); w.GetMapName() != "frontier" {
		t.Errorf("Welcome.MapName = %q, want frontier", w.GetMapName())
	}
	bare, _ := testHub(t)
	if _, w := join(t, bare, "a"); w.GetMapName() != "" {
		t.Errorf("Welcome.MapName without a map = %q, want empty", w.GetMapName())
	}
}

func TestFrontier_OnlyRingOneIsOpenAtFirst(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	if _, w := join(t, hub, "a"); w.GetFrontier().GetOpenRings() != 1 {
		t.Errorf("Welcome.Frontier = %+v, want ring 1 open", w.GetFrontier())
	}
	all, _ := testHub(t, WithOpenRings(3))
	if _, w := join(t, all, "a"); w.GetFrontier().GetOpenRings() != 3 {
		t.Errorf("Welcome.Frontier = %+v with every ring saved open, want 3", w.GetFrontier())
	}
}

func TestFrontier_AClosedSectorsGarrisonStaysAsleep(t *testing.T) {
	t.Parallel()

	d2, _ := sim.ParseSector("D2")
	c := d2.Center()
	in := func(snap *pb.Snapshot) int {
		n := 0
		for _, e := range snap.GetEnemies() {
			if d2.Contains(float64(e.GetX()), float64(e.GetY())) {
				n++
			}
		}

		return n
	}

	hub, tick := testHub(t)
	a, _ := join(t, hub, "a")
	if n := in(must(latest(t, a, tick, 2, float32(c.X), float32(c.Y)))); n != 0 {
		t.Errorf("%d enemies in closed D2 with a ship in it, want its garrison asleep", n)
	}
	open, tick := testHub(t, WithOpenRings(2))
	b, _ := join(t, open, "b")
	if n := in(must(latest(t, b, tick, 2, float32(c.X), float32(c.Y)))); n == 0 {
		t.Error("no enemies in D2 with ring 2 open and a ship in it, want its garrison awake")
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

func TestGarrison_TakesTheFieldAllOverItsSector(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithEveryEnemy())
	a, _ := join(t, hub, "a")
	snap, _ := latest(t, a, tick, 1, enterX, enterY)

	if got, want := len(snap.GetEnemies()), sim.GarrisonSize(1); got != want {
		t.Fatalf("%d enemies once a player entered E4, want its garrison of %d", got, want)
	}
	e4, _ := sim.ParseSector("E4")
	farthest := 0.0
	for _, e := range snap.GetEnemies() {
		x, y := float64(e.GetX()), float64(e.GetY())
		if !e4.Inside(x, y, RoamMargin-sim.ShipRadius) {
			t.Errorf(
				"enemy %d took the field at (%.0f, %.0f), not well inside E4",
				e.GetEnemyId(),
				x,
				y,
			)
		}
		farthest = max(farthest, math.Hypot(x-float64(e4X), y-float64(e4Y)))
	}
	if farthest < sim.SectorApothem/2 {
		t.Errorf(
			"the farthest enemy is %.0f px from E4's center, want them spread over the sector",
			farthest,
		)
	}
}

func TestGarrison_GrowsWithTheShipsThatEnter(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithEveryEnemy())
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")
	b.Send(state(enterX, enterY+50))
	snap, _ := latest(t, a, tick, 1, enterX, enterY)

	if got, want := inE4(snap), sim.GarrisonSize(1)*3/2; got != want {
		t.Errorf("%d enemies for two players, want half again the base, %d", got, want)
	}
}

func TestGarrison_HoldsItsSectorAndRoamsItOnceThePlayerLeaves(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithEveryEnemy())
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
	before, _ := latest(t, a, tick, 10*TickRate, nearX, nearY)
	after, _ := latest(t, a, tick, 5*TickRate, nearX, nearY)
	moved := 0
	for _, e := range after.GetEnemies() {
		if d := e4.Beyond(float64(e.GetX()), float64(e.GetY())); d > 0 {
			t.Errorf("enemy %d is %.0f px out of E4 after the player left", e.GetEnemyId(), d)
		}
		for _, b := range before.GetEnemies() {
			if b.GetEnemyId() == e.GetEnemyId() &&
				math.Hypot(float64(e.GetX()-b.GetX()), float64(e.GetY()-b.GetY())) > 20 {
				moved++
			}
		}
	}
	if moved < len(after.GetEnemies())/2 {
		t.Errorf(
			"%d of %d enemies moved over 5 s with nobody near, want them roaming",
			moved,
			len(after.GetEnemies()),
		)
	}

	// Roaming, each faces where it's going (#121).
	next, _ := latest(t, a, tick, 1, nearX, nearY)
	for _, e := range next.GetEnemies() {
		for _, b := range after.GetEnemies() {
			dx, dy := float64(e.GetX()-b.GetX()), float64(e.GetY()-b.GetY())
			if b.GetEnemyId() != e.GetEnemyId() || math.Hypot(dx, dy) < 0.5 {
				continue
			}
			off := math.Abs(sim.WrapAngle(float64(e.GetAngle()) - math.Atan2(dy, dx)))
			if off > 0.3 {
				t.Errorf("enemy %d faces %.2f rad off where it's roaming", e.GetEnemyId(), off)
			}
		}
	}
}

func TestGarrison_StandsDownWithNobodyNearAndKeepsItsLosses(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithEveryEnemy())
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
	hub, tick := testHub(
		t,
		WithEveryEnemy(),
		WithMap(m),
		WithSaveSector(func(name string) { saved <- name }),
	)
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
	hub, tick := testHub(t, WithEveryEnemy(), WithMap(m), NoEvents)
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
	hub, tick := testHub(t, WithEveryEnemy(), WithMap(m))
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
