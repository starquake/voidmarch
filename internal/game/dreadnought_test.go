package game_test

import (
	"fmt"
	"log/slog"
	"math"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
	"github.com/starquake/voidmarch/internal/world"
)

// ringOne names n of ring 1's sectors, for a hub that has cleared them.
func ringOne(n int) []string {
	return ringOf(1, n)
}

// ringOf names n of ring's sectors, for a hub that has cleared them.
func ringOf(ring, n int) []string {
	var names []string
	for _, s := range sim.Sectors() {
		if s.Ring() == ring && len(names) < n {
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
	mu     sync.Mutex
	shares []float64
	rings  []int
}

func (s *saved) share(_ sim.EnemyFaction, share float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.shares = append(s.shares, share)
}

func (s *saved) ring(n int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rings = append(s.rings, n)
}

func (s *saved) all() (shares []float64, rings []int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	return slices.Clone(s.shares), slices.Clone(s.rings)
}

// settle waits up to a second for the saves, which run off the tick
// goroutine, to satisfy ok, and returns them.
func (s *saved) settle(
	ok func(shares []float64, rings []int) bool,
) (shares []float64, rings []int) {
	deadline := time.Now().Add(time.Second)
	for {
		shares, rings = s.all()
		if ok(shares, rings) || time.Now().After(deadline) {
			return shares, rings
		}
		time.Sleep(time.Millisecond)
	}
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
	full := float32(sim.DreadnoughtMaxHP(1))
	if !ok || s.Ring() != 2 || d.GetHp() != full || d.GetMaxHp() != full {
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

func TestDreadnought_KeepsItsShareAndScalesToThoseOnline(t *testing.T) {
	t.Parallel()

	m := &world.Map{Name: "test", DreadnoughtAwake: true, NoEvents: true}
	hub, tick := testHub(t, WithMap(m), WithDreadnought(sim.Klaed, 0.75))
	a, _ := join(t, hub, "a")
	d := dreadnoughtIn(must(latest(t, a, tick, 1, 0, 0)))
	if got, want := d.GetHp(), float32(math.Round(0.75*sim.DreadnoughtMaxHP(1))); got != want ||
		d.GetMaxHp() != float32(sim.DreadnoughtMaxHP(1)) {
		t.Fatalf("Dreadnought %+v with one player online, want the saved share, %v", d, want)
	}
	// A hundredth of its health an hour is 1/72,000 a tick, so 7,200 ticks
	// give back a thousandth of it.
	start := d.GetHp()
	after := dreadnoughtIn(must(latest(t, a, tick, 7200, 0, 0))).GetHp()
	want := sim.DreadnoughtMaxHP(1) / 1000
	if got := float64(after - start); math.Abs(got-want) > 1 {
		t.Errorf("hp went up %v in 7200 ticks, want about %v", got, want)
	}
	b, _ := join(t, hub, "b")
	b.Send(state(0, 0))
	d = dreadnoughtIn(must(latest(t, a, tick, 1, 0, 0)))
	drain(b)
	// Both health figures are rounded, half a point of each.
	share := float64(after) / sim.DreadnoughtMaxHP(1)
	if got, want := d.GetMaxHp(), float32(sim.DreadnoughtMaxHP(2)); got != want ||
		math.Abs(float64(d.GetHp()/want)-share) > 3e-4 {
		t.Errorf(
			"Dreadnought %+v with a second player far away, want %v of %v",
			d,
			share,
			want,
		)
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
		WithDreadnought(sim.Klaed, 0.003),
		WithSaveDreadnought(saves.share),
		WithSaveOpenRings(saves.ring),
		// Ring 1 holds, so the rings stay open once it falls.
		WithClearedSectors(ringOne(4)),
	)
	a, _ := join(t, hub, "a")
	d := dreadnoughtIn(must(latest(t, a, tick, 1, 0, 0)))
	shots := sim.DreadnoughtShield/MaxHitDamage + 1
	for shot := range uint32(shots) { //nolint:gosec // a few shots.
		hitFrigate(a, d.GetEnemyId(), shot+1)
	}
	d = dreadnoughtIn(must(latest(t, a, tick, 1, 0, 0)))
	if d == nil || d.GetHp() >= float32(0.003*sim.DreadnoughtMaxHP(1)) || d.GetShield() != 0 {
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
	// The Kla'ed Dreadnought opens ring 2 alone; ring 3 is the Nairan one's (#140).
	if frontier.GetOpenRings() != 2 {
		t.Errorf("frontier %+v once it fell, want ring 2 open", frontier)
	}
	fell := func(shares []float64, rings []int) bool {
		return slices.Contains(shares, 1) && slices.Equal(rings, []int{2})
	}
	if shares, rings := saves.settle(fell); !fell(shares, rings) {
		t.Errorf(
			"saved shares %v and rings %v, want a fresh Dreadnought's whole health and 2 rings",
			shares,
			rings,
		)
	}
}

func TestDreadnought_ItsFallRewardsThoseNearAndReleasesDerelicts(t *testing.T) {
	t.Parallel()

	m := &world.Map{Name: "test", DreadnoughtAwake: true, NoEvents: true}
	hub, tick := testHub(t, WithMap(m), WithDreadnought(sim.Klaed, 0.0005), WithPoolStart(3))
	near, _ := join(t, hub, "near")
	far, _ := join(t, hub, "far")
	d := dreadnoughtIn(must(latest(t, near, tick, 1, 0, 0)))
	x, y := d.GetX(), d.GetY()+300
	far.Send(state(0, 0))
	must(latest(t, near, tick, 1, x, y))
	drain(far)

	shots := sim.DreadnoughtShield/MaxHitDamage + 2
	for shot := range uint32(shots) { //nolint:gosec // a few shots.
		hitFrigate(near, d.GetEnemyId(), shot+1)
	}
	snap, others := latest(t, near, tick, 1, x, y)
	var fell *pb.BossFell
	for _, msg := range others {
		if f := msg.GetBossFell(); f != nil {
			fell = f
		}
	}
	if fell == nil || fell.GetKind() != pb.EnemyKind_ENEMY_KIND_DREADNOUGHT {
		t.Fatalf("BossFell = %+v, want the Dreadnought's fall", fell)
	}
	got := map[string]bool{}
	for _, g := range fell.GetGains() {
		got[g.GetPlayerId()] = true
	}
	if !got["near"] || got["far"] {
		t.Errorf("parts went to %v, want the player near it and not the one far away", got)
	}
	free := 0
	for _, dr := range snap.GetDerelicts() {
		if !dr.GetHeld() &&
			math.Hypot(float64(dr.GetX()-d.GetX()), float64(dr.GetY()-d.GetY())) < 200 {
			free++
		}
	}
	if free != sim.DreadnoughtDerelicts {
		t.Errorf("%d free derelicts by the wreck, want %d", free, sim.DreadnoughtDerelicts)
	}
}

// frontierIn is the last Frontier among messages, or nil.
func frontierIn(messages []*pb.ServerMessage) *pb.Frontier {
	var f *pb.Frontier
	for _, msg := range messages {
		if got := msg.GetFrontier(); got != nil {
			f = got
		}
	}

	return f
}

func TestDreadnought_TheRingsCloseWhenRingOneFallsBack(t *testing.T) {
	t.Parallel()

	saves := &saved{}
	hub, tick := testHub(
		t,
		WithOpenRings(3),
		WithClearedSectors(ringOne(3)),
		WithSaveOpenRings(saves.ring),
		NoEvents,
	)
	a, _ := join(t, hub, "a")
	_, others := latest(t, a, tick, 1, 0, 0)
	if f := frontierIn(others); f.GetOpenRings() != 1 {
		t.Errorf(
			"frontier %+v with rings 2 and 3 open and 3 of ring 1 cleared, want them closed",
			f,
		)
	}
	closed := func(_ []float64, rings []int) bool { return slices.Equal(rings, []int{1}) }
	if _, rings := saves.settle(closed); !slices.Equal(rings, []int{1}) {
		t.Errorf("saved rings %v, want 1", rings)
	}

	kept, tick := testHub(t, WithOpenRings(2), WithClearedSectors(ringOne(4)), NoEvents)
	b, _ := join(t, kept, "b")
	if _, others := latest(t, b, tick, 2, 0, 0); frontierIn(others) != nil {
		t.Errorf(
			"frontier %+v with 4 of ring 1 cleared, want ring 2 left open",
			frontierIn(others),
		)
	}

	// Ring 2 falling back closes ring 3 alone (#140).
	outer, tick := testHub(
		t,
		WithOpenRings(3),
		WithClearedSectors(append(ringOne(4), ringOf(2, 3)...)),
		NoEvents,
	)
	c, _ := join(t, outer, "c")
	if _, others := latest(t, c, tick, 1, 0, 0); frontierIn(others).GetOpenRings() != 2 {
		t.Errorf(
			"frontier %+v with 4 of ring 1 and 3 of ring 2 cleared, want ring 3 closed",
			frontierIn(others),
		)
	}
}

func TestDreadnought_ReopeningTakesAFreshOne(t *testing.T) {
	t.Parallel()

	// Ring 1 fell back to 3 cleared while rings 2 and 3 were open; E4's
	// garrison of one is all that stands between it and 4 again.
	cleared := slices.DeleteFunc(ringOne(6), func(n string) bool { return n == "E4" })[:3]
	m := &world.Map{Name: "test", Garrisons: map[string]int{"E4": 1}, NoEvents: true}
	hub, tick := testHub(t, WithMap(m), WithOpenRings(3), WithClearedSectors(cleared))
	a, _ := join(t, hub, "a")
	if f := frontierIn(must2(latest(t, a, tick, 1, 0, 0))); f.GetOpenRings() != 1 {
		t.Fatalf("frontier %+v, want rings 2 and 3 closed first", f)
	}
	snap := must(latest(t, a, tick, 1, enterX, enterY))
	killAll(a, snap)
	for range 3 {
		snap = must(latest(t, a, tick, 1, enterX, enterY))
	}
	d := dreadnoughtIn(snap)
	if d == nil || d.GetHp() != d.GetMaxHp() {
		t.Errorf("Dreadnought %+v once ring 1 was back at 4, want a fresh one at full health", d)
	}
}

// must2 is the messages from latest, without its snapshot.
func must2(_ *pb.Snapshot, messages []*pb.ServerMessage) []*pb.ServerMessage {
	return messages
}

func TestDreadnought_TheNairanOneWakesInRingThreeAndItsFallOpensIt(t *testing.T) {
	t.Parallel()

	saves := &saved{}
	hub, tick := testHub(
		t,
		WithOpenRings(2),
		WithClearedSectors(append(ringOne(6), ringOf(2, 4)...)),
		WithDreadnought(sim.Nairan, 0.0005),
		WithDreadnought(sim.Klaed, 0.4),
		WithSaveDreadnought(saves.share),
		WithSaveOpenRings(saves.ring),
		WithPoolStart(3),
		NoEvents,
	)
	a, _ := join(t, hub, "a")
	snap, others := latest(t, a, tick, 2, 0, 0)
	d := dreadnoughtIn(snap)
	if d == nil || d.GetFaction() != pb.EnemyFaction_ENEMY_FACTION_NAIRAN {
		t.Fatalf("Dreadnought %+v with 4 of ring 2 cleared, want the Nairan one awake", d)
	}
	s, _ := sim.SectorAt(float64(d.GetX()), float64(d.GetY()))
	if s.Ring() != 3 || !slices.Equal(frontierIn(others).GetOpened(), []string{s.Name()}) {
		t.Errorf(
			"the Nairan Dreadnought woke in %s (ring %d), want a ring-3 sector open on its own",
			s.Name(),
			s.Ring(),
		)
	}
	if want := float32(0.0005 * sim.DreadnoughtMaxHP(1)); math.Abs(float64(d.GetHp()-want)) > 1 {
		t.Errorf("its hp = %v, want its own saved share, %v, not the Kla'ed one's", d.GetHp(), want)
	}

	x, y := d.GetX(), d.GetY()+300
	must(latest(t, a, tick, 1, x, y))
	for shot := range uint32(sim.DreadnoughtShield/MaxHitDamage + 2) { //nolint:gosec // a few shots.
		hitFrigate(a, d.GetEnemyId(), shot+1)
	}
	_, others = latest(t, a, tick, 1, x, y)
	var fell *pb.BossFell
	for _, msg := range others {
		if f := msg.GetBossFell(); f != nil {
			fell = f
		}
	}
	if fell.GetFaction() != pb.EnemyFaction_ENEMY_FACTION_NAIRAN ||
		frontierIn(others).GetOpenRings() != 3 {
		t.Errorf(
			"BossFell %+v and frontier %+v, want the Nairan one fallen and ring 3 open",
			fell,
			frontierIn(others),
		)
	}
	opened := func(_ []float64, rings []int) bool { return slices.Equal(rings, []int{3}) }
	if _, rings := saves.settle(opened); !slices.Equal(rings, []int{3}) {
		t.Errorf("saved rings %v, want 3", rings)
	}
}

func TestDreadnought_ANairanOneAwakeGoesBackToSleepWhenRingOneFallsBack(t *testing.T) {
	t.Parallel()

	saves := &saved{}
	hub, tick := testHub(
		t,
		WithOpenRings(2),
		WithClearedSectors(append(ringOne(4), ringOf(2, 4)...)),
		WithDreadnought(sim.Nairan, 0.6),
		WithSaveDreadnought(saves.share),
		WithWokenThenLost(ringOne(1)[0]),
		NoEvents,
	)
	a, _ := join(t, hub, "a")
	snap, others := latest(t, a, tick, 2, 0, 0)
	if d := dreadnoughtIn(snap); d != nil {
		t.Errorf("Dreadnought %+v after ring 1 fell back, want it gone", d)
	}
	if f := frontierIn(others); f.GetOpenRings() != 1 || len(f.GetOpened()) != 0 {
		t.Errorf("frontier %+v after ring 1 fell back, want ring 1 alone", f)
	}
	kept := func(shares []float64, _ []int) bool { return slices.Contains(shares, 0.6) }
	if shares, _ := saves.settle(kept); !kept(shares, nil) {
		t.Errorf("saved shares %v, want the Nairan one's 0.6 kept", shares)
	}
}

// finaleCleared is a world with every ring open and 4 of each cleared, so
// the Nautolan Dreadnought wakes.
func finaleCleared() []string {
	return slices.Concat(ringOne(6), ringOf(2, 4), ringOf(3, 4))
}

func TestDreadnought_TheNautolanOneIsTheFinale(t *testing.T) {
	t.Parallel()

	var won atomic.Bool
	hub, tick := testHub(
		t,
		WithOpenRings(3),
		WithClearedSectors(finaleCleared()),
		WithDreadnought(sim.Nautolan, 0.0005),
		WithSaveSeasonWon(func(time.Time) { won.Store(true) }),
		WithPoolStart(3),
		NoEvents,
	)
	a, _ := join(t, hub, "a")
	snap, others := latest(t, a, tick, 2, 0, 0)
	d := dreadnoughtIn(snap)
	if d == nil || d.GetFaction() != pb.EnemyFaction_ENEMY_FACTION_NAUTOLAN {
		t.Fatalf("Dreadnought %+v with 4 of ring 3 cleared, want the Nautolan one awake", d)
	}
	if s, _ := sim.SectorAt(float64(d.GetX()), float64(d.GetY())); s.Ring() != sim.GridRings {
		t.Errorf("the Nautolan Dreadnought woke in %s (ring %d), want ring 3", s.Name(), s.Ring())
	}
	if f := frontierIn(others); len(f.GetOpened()) != 0 {
		t.Errorf("frontier %+v, want no sector opened on its own: ring 3 is open", f)
	}

	x, y := d.GetX(), d.GetY()+300
	must(latest(t, a, tick, 1, x, y))
	for shot := range uint32(sim.DreadnoughtShield/MaxHitDamage + 2) { //nolint:gosec // a few shots.
		hitFrigate(a, d.GetEnemyId(), shot+1)
	}
	_, others = latest(t, a, tick, 1, x, y)
	var fell *pb.BossFell
	for _, msg := range others {
		if f := msg.GetBossFell(); f != nil {
			fell = f
		}
	}
	if fell.GetFaction() != pb.EnemyFaction_ENEMY_FACTION_NAUTOLAN {
		t.Errorf("BossFell %+v, want the Nautolan one fallen", fell)
	}
	// Its sector is cleared before the season is won, unless it was already.
	s := dreadnoughtSector(t, d)
	clearedAt, wonAt := -1, -1
	for i, msg := range others {
		if c := msg.GetSectorCleared(); c != nil && c.GetSector() == s.Name() {
			clearedAt = i
		}
		if msg.GetSeasonWon() != nil {
			wonAt = i
		}
	}
	before := slices.Contains(finaleCleared(), s.Name())
	if wonAt < 0 || (!before && (clearedAt < 0 || clearedAt > wonAt)) ||
		(before && clearedAt >= 0) {
		t.Errorf(
			"%s cleared at message %d and the season won at %d (cleared before: %t), want it cleared once, first",
			s.Name(),
			clearedAt,
			wonAt,
			before,
		)
	}
	deadline := time.Now().Add(time.Second)
	for !won.Load() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if !won.Load() {
		t.Error("the season wasn't saved as won when the finale fell")
	}
	if d := dreadnoughtIn(must(latest(t, a, tick, 5, x, y))); d != nil {
		t.Errorf("Dreadnought %+v after the finale fell, want none until a new season", d)
	}
}

func TestDreadnought_AWonSeasonKeepsTheFinaleAsleep(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(
		t,
		WithOpenRings(3),
		WithClearedSectors(finaleCleared()),
		WithSeason(time.Unix(1, 0), time.Unix(2, 0)),
		NoEvents,
	)
	a, _ := join(t, hub, "a")
	if d := dreadnoughtIn(must(latest(t, a, tick, 3, 0, 0))); d != nil {
		t.Errorf("Dreadnought %+v in a won season, want none", d)
	}

	// Ring 1 fallen back to 3 cleared: the world stays open all the same.
	open, tick := testHub(
		t,
		WithOpenRings(3),
		WithClearedSectors(ringOne(3)),
		WithSeason(time.Unix(1, 0), time.Unix(2, 0)),
		NoEvents,
	)
	b, _ := join(t, open, "b")
	if f := frontierIn(must2(latest(t, b, tick, 2, 0, 0))); f != nil {
		t.Errorf(
			"frontier %+v in a won season with ring 1 fallen back, want every ring left open",
			f,
		)
	}
}

func TestDreadnought_TheFinaleSleepsWhenRingThreeFallsBack(t *testing.T) {
	t.Parallel()

	saves := &saved{}
	hub, tick := testHub(
		t,
		WithOpenRings(3),
		WithClearedSectors(finaleCleared()),
		WithDreadnought(sim.Nautolan, 0.6),
		WithSaveDreadnought(saves.share),
		WithSaveOpenRings(saves.ring),
		WithWokenThenLost(ringOf(3, 1)[0]),
		NoEvents,
	)
	a, _ := join(t, hub, "a")
	snap, others := latest(t, a, tick, 2, 0, 0)
	if d := dreadnoughtIn(snap); d != nil {
		t.Errorf("Dreadnought %+v after ring 3 fell back to 3 cleared, want it asleep", d)
	}
	if f := frontierIn(others); f != nil && f.GetOpenRings() != sim.GridRings {
		t.Errorf("frontier %+v, want every ring left open", f)
	}
	kept := func(shares []float64, _ []int) bool { return slices.Contains(shares, 0.6) }
	if shares, rings := saves.settle(kept); !kept(shares, nil) || len(rings) != 0 {
		t.Errorf(
			"saved shares %v and rings %v, want the Nautolan one's 0.6 kept and no ring closed",
			shares,
			rings,
		)
	}
}

func TestDreadnoughtGap_TheLaterFactionsFireMoreOften(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		faction sim.EnemyFaction
		want    int
	}{
		{sim.Klaed, DreadnoughtVolleyGap},
		{sim.Nairan, 27},
		{sim.Nautolan, DreadnoughtVolleyGap / 2},
	} {
		if got := DreadnoughtGap(tc.faction, DreadnoughtVolleyGap); got != tc.want {
			t.Errorf(
				"DreadnoughtGap(%s, %d) = %d, want %d",
				tc.faction,
				DreadnoughtVolleyGap,
				got,
				tc.want,
			)
		}
	}
}

// guardsIn are the enemies in s other than the bosses: its garrison, or an
// attack's force.
func guardsIn(snap *pb.Snapshot, s sim.Sector) []*pb.EnemyState {
	var out []*pb.EnemyState
	for _, e := range snap.GetEnemies() {
		boss := e.GetKind() == pb.EnemyKind_ENEMY_KIND_DREADNOUGHT ||
			e.GetKind() == pb.EnemyKind_ENEMY_KIND_FRIGATE
		if !boss && s.Contains(float64(e.GetX()), float64(e.GetY())) {
			out = append(out, e)
		}
	}

	return out
}

// dreadnoughtSector is the sector the snapshot's Dreadnought holds.
func dreadnoughtSector(t *testing.T, d *pb.EnemyState) sim.Sector {
	t.Helper()

	s, ok := sim.SectorAt(float64(d.GetX()), float64(d.GetY()))
	if !ok {
		t.Fatalf("Dreadnought %+v off the grid", d)
	}

	return s
}

func TestDreadnought_ItsSectorsGarrisonStaysOffTheFieldWhileItsAwake(t *testing.T) {
	t.Parallel()

	m := &world.Map{Name: "test", DreadnoughtAwake: true, NoEvents: true}
	hub, tick := testHub(t, WithEveryEnemy(), WithMap(m))
	a, _ := join(t, hub, "a")
	d := dreadnoughtIn(must(latest(t, a, tick, 1, 0, 0)))
	s := dreadnoughtSector(t, d)
	x, y := d.GetX(), d.GetY()+150
	for range 5 * TickRate {
		if guards := guardsIn(must(latest(t, a, tick, 1, x, y)), s); len(guards) > 0 {
			t.Fatalf(
				"%d of %s's garrison out with a ship in it while the Dreadnought is awake, want none",
				len(guards),
				s.Name(),
			)
		}
	}
}

func TestDreadnought_StandsDownAGarrisonOutWhenItWoke(t *testing.T) {
	t.Parallel()

	m := &world.Map{Name: "test", DreadnoughtAwake: true, NoEvents: true}
	hub, tick := testHub(t, WithEveryEnemy(), WithMap(m), WithDreadnoughtGarrisonOut(0))
	a, _ := join(t, hub, "a")
	snap := must(latest(t, a, tick, 2, 0, 0))
	if guards := guardsIn(snap, dreadnoughtSector(t, dreadnoughtIn(snap))); len(guards) > 0 {
		t.Errorf(
			"%d of its sector's garrison still out once the Dreadnought woke, want it stood down",
			len(guards),
		)
	}
}

func TestDreadnought_NoAttackComesToItsSector(t *testing.T) {
	t.Parallel()

	m := &world.Map{Name: "test", DreadnoughtAwake: true}
	hub, tick := testHub(
		t, WithMap(m), WithDevelopment(), WithDreadnoughtInClearedSector(),
		WithEventTimes(20, 200, 1<<30, 1<<30),
	)
	a, _ := join(t, hub, "a")
	d := dreadnoughtIn(must(latest(t, a, tick, 1, 0, 0)))
	s := dreadnoughtSector(t, d)
	a.Send(devAttack(s.Name()))
	started, _, _ := eventMessages(t, a, tick, 41, 0, 0)
	for _, e := range started {
		ev := e.GetEvent()
		if ev.GetKind() == pb.WorldEventKind_WORLD_EVENT_KIND_ATTACK && ev.GetSector() == s.Name() {
			t.Errorf(
				"an attack came to %s, the awake Dreadnought's sector, want none there",
				s.Name(),
			)
		}
	}
}

// sectorSaves collects the sectors a hub saves as cleared, off its tick
// goroutine.
type sectorSaves struct {
	mu    sync.Mutex
	names []string
}

func (s *sectorSaves) save(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.names = append(s.names, name)
}

// settle waits up to a second for name to be saved, and returns the saves.
func (s *sectorSaves) settle(name string) []string {
	deadline := time.Now().Add(time.Second)
	for {
		s.mu.Lock()
		names := slices.Clone(s.names)
		s.mu.Unlock()
		if slices.Contains(names, name) || time.Now().After(deadline) {
			return names
		}
		time.Sleep(time.Millisecond)
	}
}

// felled shoots down the Dreadnought d, at a sliver of its health, from
// beside it, and returns the messages of the tick it fell in.
func felled(t *testing.T, a *Session, tick func(int), d *pb.EnemyState) []*pb.ServerMessage {
	t.Helper()

	x, y := d.GetX(), d.GetY()+300
	must(latest(t, a, tick, 1, x, y))
	for shot := range uint32(sim.DreadnoughtShield/MaxHitDamage + 2) { //nolint:gosec // a few shots.
		hitFrigate(a, d.GetEnemyId(), shot+1)
	}
	_, others := latest(t, a, tick, 1, x, y)

	return others
}

// clearedIn are the sectors cleared among messages.
func clearedIn(messages []*pb.ServerMessage) []string {
	var out []string
	for _, msg := range messages {
		if c := msg.GetSectorCleared(); c != nil {
			out = append(out, c.GetSector())
		}
	}

	return out
}

func TestDreadnought_ItsFallClearsItsSectorTowardTheNextWake(t *testing.T) {
	t.Parallel()

	saves := &sectorSaves{}
	hub, tick := testHub(
		t,
		WithClearedSectors(ringOne(4)),
		WithClearedBesideDreadnought(sim.DreadnoughtWakesAt-1),
		WithDreadnought(sim.Klaed, 0.0005),
		WithSaveSector(saves.save),
		WithPoolStart(3),
		NoEvents,
	)
	a, _ := join(t, hub, "a")
	d := dreadnoughtIn(must(latest(t, a, tick, 1, 0, 0)))
	s := dreadnoughtSector(t, d)
	if got := clearedIn(felled(t, a, tick, d)); !slices.Equal(got, []string{s.Name()}) {
		t.Errorf("sectors cleared as it fell = %v, want its own, %s", got, s.Name())
	}
	if got := saves.settle(s.Name()); !slices.Contains(got, s.Name()) {
		t.Errorf("saved sectors %v, want %s", got, s.Name())
	}
	// Its sector makes 4 of ring 2 cleared, so the Nairan one wakes.
	next := dreadnoughtIn(must(latest(t, a, tick, 2, 0, 0)))
	if next.GetFaction() != pb.EnemyFaction_ENEMY_FACTION_NAIRAN {
		t.Errorf("Dreadnought %+v after the Kla'ed one fell, want the Nairan one awake", next)
	}
}

func TestDreadnought_ItsFallClearsAGarrisonFoughtBefore(t *testing.T) {
	t.Parallel()

	m := &world.Map{Name: "test", DreadnoughtAwake: true, NoEvents: true}
	hub, tick := testHub(
		t, WithEveryEnemy(),
		WithMap(m),
		WithClearedSectors(ringOne(4)),
		WithDreadnoughtGarrisonOut(2),
		WithDreadnought(sim.Klaed, 0.0005),
	)
	a, _ := join(t, hub, "a")
	d := dreadnoughtIn(must(latest(t, a, tick, 1, 0, 0)))
	s := dreadnoughtSector(t, d)
	if got := clearedIn(felled(t, a, tick, d)); !slices.Equal(got, []string{s.Name()}) {
		t.Errorf(
			"sectors cleared as it fell = %v, want its own, %s, part of its garrison gone",
			got,
			s.Name(),
		)
	}
	x, y := d.GetX(), d.GetY()+150
	if guards := guardsIn(must(latest(t, a, tick, 2*TickRate, x, y)), s); len(guards) > 0 {
		t.Errorf("%d of %s's garrison out once it was cleared, want none", len(guards), s.Name())
	}
}

func TestDreadnought_ItsFallLeavesASectorClearedBeforeAsItIs(t *testing.T) {
	t.Parallel()

	m := &world.Map{Name: "test", DreadnoughtAwake: true, NoEvents: true}
	hub, tick := testHub(
		t,
		WithMap(m),
		WithClearedSectors(ringOne(4)),
		WithDreadnoughtInClearedSector(),
		WithDreadnought(sim.Klaed, 0.0005),
	)
	a, _ := join(t, hub, "a")
	d := dreadnoughtIn(must(latest(t, a, tick, 1, 0, 0)))
	if got := clearedIn(felled(t, a, tick, d)); len(got) != 0 {
		t.Errorf("sectors cleared as it fell in a sector cleared before = %v, want none", got)
	}
}

func TestDreadnought_ItsClearedSectorStaysClearedBehindAClosedRing(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(
		t,
		WithClearedSectors(ringOne(4)),
		WithDreadnought(sim.Klaed, 0.0005),
		WithDevelopment(),
		WithEventTimes(1<<30, 40, 1<<30, 1<<30),
	)
	a, _ := join(t, hub, "a")
	d := dreadnoughtIn(must(latest(t, a, tick, 1, 0, 0)))
	s := dreadnoughtSector(t, d)
	if got := clearedIn(felled(t, a, tick, d)); !slices.Equal(got, []string{s.Name()}) {
		t.Fatalf("sectors cleared as it fell = %v, want %s", got, s.Name())
	}
	// Ring 1 falls back: an attack nobody fights takes one of its sectors.
	a.Send(devAttack(ringOne(1)[0]))
	var frontier *pb.Frontier
	for range 60 {
		if f := frontierIn(must2(latest(t, a, tick, 1, 0, 0))); f != nil {
			frontier = f
		}
	}
	if frontier.GetOpenRings() != 1 {
		t.Fatalf("frontier %+v once ring 1 fell back, want ring 2 closed", frontier)
	}
	_, w := join(t, hub, "b")
	if !slices.Contains(w.GetClearedSectors(), s.Name()) {
		t.Errorf(
			"cleared sectors %v behind the closed ring, want %s kept cleared",
			w.GetClearedSectors(),
			s.Name(),
		)
	}
}

// damageLines are the "dreadnought damage" lines among logs.
func damageLines(logs *syncBuffer) []string {
	var out []string
	for line := range strings.Lines(logs.String()) {
		if strings.Contains(line, `msg="dreadnought damage"`) {
			out = append(out, line)
		}
	}

	return out
}

func TestDreadnought_LogsEachShipsDamageAMinuteAndAtItsFall(t *testing.T) {
	t.Parallel()

	logs := &syncBuffer{}
	m := &world.Map{Name: "test", DreadnoughtAwake: true, NoEvents: true}
	hub, tick := loggedHub(
		t,
		slog.New(slog.NewTextHandler(logs, nil)),
		WithMap(m),
		WithDreadnought(sim.Klaed, 0.01),
	)
	a, _ := join(t, hub, "a")
	d := dreadnoughtIn(must(latest(t, a, tick, 1, 0, 0)))
	shots := sim.DreadnoughtShield/MaxHitDamage + 2
	for shot := range uint32(shots) { //nolint:gosec // a few shots.
		hitFrigate(a, d.GetEnemyId(), shot+1)
	}
	must(latest(t, a, tick, 1, 0, 0))
	if got := damageLines(logs); len(got) != 0 {
		t.Errorf("logged %q within a minute of the first hit, want nothing yet", got)
	}

	must(latest(t, a, tick, 70*TickRate, 0, 0))
	want := fmt.Sprintf(
		"ship=a name=name-a faction=klaed weapon=autoCannon tier=0 damage=%d seconds=60",
		shots*MaxHitDamage-sim.DreadnoughtShield,
	)
	if got := damageLines(logs); len(got) != 1 || !strings.Contains(got[0], want) {
		t.Errorf("logged %q a minute on, want one line with %q", got, want)
	}

	for shot := range uint32(1000) {
		hitFrigate(a, d.GetEnemyId(), 100+shot)
	}
	must(latest(t, a, tick, 2, 0, 0))
	got := damageLines(logs)
	if len(got) != 2 || !strings.Contains(got[1], "ship=a ") ||
		strings.Contains(got[1], "seconds=60") {
		t.Errorf("logged %q once it fell, want a second line for a's last seconds", got)
	}
}
