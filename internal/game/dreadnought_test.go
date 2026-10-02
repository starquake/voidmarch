package game_test

import (
	"slices"
	"sync"
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
	"github.com/starquake/voidmarch/internal/world"
)

// ringOne names n of ring 1's sectors, for a hub that has cleared them.
func ringOne(n int) []string {
	var names []string
	for _, s := range sim.Sectors() {
		if s.Ring() == 1 && len(names) < n {
			names = append(names, s.Name())
		}
	}

	return names
}

// dreadnoughtIn is the snapshot's Dreadnought, or nil.
func dreadnoughtIn(snap *pb.Snapshot) *pb.EnemyState {
	for _, e := range snap.GetEnemies() {
		if e.GetKind() == pb.EnemyKind_ENEMY_KIND_DREADNOUGHT {
			return e
		}
	}

	return nil
}

// saved collects what a hub saves, off its tick goroutine.
type saved struct {
	mu    sync.Mutex
	hps   []int
	rings []int
}

func (s *saved) hp(hp int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.hps = append(s.hps, hp)
}

func (s *saved) ring(n int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rings = append(s.rings, n)
}

func (s *saved) all() (hps, rings []int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	return slices.Clone(s.hps), slices.Clone(s.rings)
}

func TestDreadnought_WakesOnceFourOfRingOneAreCleared(t *testing.T) {
	t.Parallel()

	asleep, tick := testHub(t, WithClearedSectors(ringOne(3)))
	a, _ := join(t, asleep, "a")
	if d := dreadnoughtIn(must(latest(t, a, tick, 2, 0, 0))); d != nil {
		t.Fatalf("Dreadnought %+v with 3 of ring 1 cleared, want it asleep", d)
	}

	awake, tick := testHub(t, WithClearedSectors(ringOne(4)))
	b, _ := join(t, awake, "b")
	snap, others := latest(t, b, tick, 2, 0, 0)
	d := dreadnoughtIn(snap)
	if d == nil {
		t.Fatal("no Dreadnought with 4 of ring 1 cleared")
	}
	s, ok := sim.SectorAt(float64(d.GetX()), float64(d.GetY()))
	if !ok || s.Ring() != 2 || d.GetHp() != sim.DreadnoughtHP || d.GetMaxHp() != sim.DreadnoughtHP {
		t.Errorf("Dreadnought %+v in %s, want it in ring 2 at full health", d, s.Name())
	}
	var frontier *pb.Frontier
	for _, msg := range others {
		if f := msg.GetFrontier(); f != nil {
			frontier = f
		}
	}
	if frontier == nil || frontier.GetOpenRings() != 1 ||
		!slices.Equal(frontier.GetOpened(), []string{s.Name()}) {
		t.Errorf(
			"frontier %+v once it woke, want ring 1 open and %s on its own",
			frontier,
			s.Name(),
		)
	}
	if _, w := join(t, awake, "c"); !slices.Equal(w.GetFrontier().GetOpened(), []string{s.Name()}) {
		t.Errorf("a joiner's frontier = %+v, want %s open on its own", w.GetFrontier(), s.Name())
	}
}

func TestDreadnought_NeverWakesWithTheRingsOpen(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithClearedSectors(ringOne(6)), WithOpenRings(3))
	a, _ := join(t, hub, "a")
	if d := dreadnoughtIn(must(latest(t, a, tick, 2, 0, 0))); d != nil {
		t.Errorf("Dreadnought %+v with rings 2 and 3 open, want none", d)
	}
}

func TestDreadnought_KeepsItsHealthAndRegenerates(t *testing.T) {
	t.Parallel()

	m := &world.Map{Name: "test", DreadnoughtAwake: true}
	hub, tick := testHub(t, WithMap(m), WithDreadnought(150_000))
	a, _ := join(t, hub, "a")
	start := dreadnoughtIn(must(latest(t, a, tick, 1, 0, 0))).GetHp()
	if start != 150_000 {
		t.Fatalf("hp = %v, want the saved 150000", start)
	}
	// An hour's 2,000 is one point every 36 ticks.
	after := dreadnoughtIn(must(latest(t, a, tick, 360, 0, 0))).GetHp()
	if got := after - start; got < 9 || got > 10 {
		t.Errorf("hp went up %v in 360 ticks, want about 10", got)
	}
}

func TestDreadnought_TakesItsVolleysInTurn(t *testing.T) {
	t.Parallel()

	m := &world.Map{Name: "test", DreadnoughtAwake: true, NoEvents: true}
	hub, tick := testHub(t, WithMap(m))
	a, _ := join(t, hub, "a")
	d := dreadnoughtIn(must(latest(t, a, tick, 1, 0, 0)))
	x, y := d.GetX(), d.GetY()+300
	var volleys []sim.DreadnoughtVolley
	for range 20 * TickRate {
		_, others := latest(t, a, tick, 1, x, y)
		for _, msg := range others {
			if f := msg.GetEnemyFired(); f != nil &&
				f.GetKind() == pb.EnemyKind_ENEMY_KIND_DREADNOUGHT {
				volleys = append(volleys, sim.DreadnoughtVolley(f.GetSeed()%3))
			}
		}
	}
	want := make([]sim.DreadnoughtVolley, 0, sim.DreadnoughtRayBeams+3)
	want = append(want, sim.DreadnoughtRing)
	for range sim.DreadnoughtRayBeams {
		want = append(want, sim.DreadnoughtRay)
	}
	want = append(want, sim.DreadnoughtWave, sim.DreadnoughtRing)
	if len(volleys) < len(want) || !slices.Equal(volleys[:len(want)], want) {
		t.Errorf(
			"volleys = %v, want a ring, a sweep of %d beams, a Wave spread, then a ring again: %v",
			volleys,
			sim.DreadnoughtRayBeams,
			want,
		)
	}
}

func TestDreadnought_FallsBehindItsShieldAndOpensTheRings(t *testing.T) {
	t.Parallel()

	saves := &saved{}
	m := &world.Map{Name: "test", DreadnoughtAwake: true, NoEvents: true}
	hub, tick := testHub(
		t,
		WithMap(m),
		WithDreadnought(30),
		WithSaveDreadnought(saves.hp),
		WithSaveOpenRings(saves.ring),
	)
	a, _ := join(t, hub, "a")
	d := dreadnoughtIn(must(latest(t, a, tick, 1, 0, 0)))
	shots := sim.DreadnoughtShield/MaxHitDamage + 1
	for shot := range uint32(shots) { //nolint:gosec // a few shots.
		hitFrigate(a, d.GetEnemyId(), shot+1)
	}
	d = dreadnoughtIn(must(latest(t, a, tick, 1, 0, 0)))
	if d == nil || d.GetHp() >= 30 || d.GetShield() != 0 {
		t.Fatalf(
			"Dreadnought %+v after its shield's worth of hits and one more, want the shield down and hurt",
			d,
		)
	}
	for shot := range uint32(5) {
		hitFrigate(a, d.GetEnemyId(), 100+shot)
	}
	snap, others := latest(t, a, tick, 1, 0, 0)
	if d = dreadnoughtIn(snap); d != nil {
		t.Fatalf("Dreadnought %+v after its health ran out, want it fallen", d)
	}
	var frontier *pb.Frontier
	for _, msg := range others {
		if f := msg.GetFrontier(); f != nil {
			frontier = f
		}
	}
	if frontier.GetOpenRings() != 3 {
		t.Errorf("frontier %+v once it fell, want rings 2 and 3 open", frontier)
	}
	must(latest(t, a, tick, 1, 0, 0))
	hps, rings := saves.all()
	if !slices.Contains(hps, sim.DreadnoughtHP) || !slices.Equal(rings, []int{3}) {
		t.Errorf(
			"saved health %v and rings %v, want a fresh Dreadnought's health and 3 rings",
			hps,
			rings,
		)
	}
}
