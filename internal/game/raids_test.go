package game_test

import (
	"math"
	"slices"
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
	"github.com/starquake/voidmarch/internal/world"
)

// raidEvery is the ticks between raids in these tests.
const raidEvery = 20

// emptyMap is a map with no garrisons and no events, so a raid is all
// there is to fight.
func emptyMap() *world.Map {
	return &world.Map{Name: "raids", NoEvents: true, Garrisons: noGarrisons()}
}

// raidHub is a hub whose raids come every raidEvery ticks, with ring 1's
// first sector cleared, unless opts say otherwise.
func raidHub(t *testing.T, opts ...HubOption) (*Hub, func(int)) {
	t.Helper()

	return testHub(t, append([]HubOption{
		WithMap(emptyMap()),
		WithRaidEvery(raidEvery, raidEvery),
		WithClearedSectors(ringOne(1)),
		WithPoolStart(3),
	}, opts...)...)
}

// raidMessages steps n ticks with s's ship at (x, y), and returns the raid
// warnings and ends among s's messages, and the last snapshot.
func raidMessages(
	t *testing.T,
	s *Session,
	tick func(int),
	n int,
	x, y float32,
) (warned []*pb.RaidWarned, ended []*pb.RaidEnded, snap *pb.Snapshot) {
	t.Helper()

	for range n {
		var others []*pb.ServerMessage
		snap, others = latest(t, s, tick, 1, x, y)
		for _, msg := range others {
			if w := msg.GetRaidWarned(); w != nil {
				warned = append(warned, w)
			}
			if e := msg.GetRaidEnded(); e != nil {
				ended = append(ended, e)
			}
		}
	}

	return warned, ended, snap
}

// e4 is E4, the ring-1 sector down and right of home, where enterX and
// enterY are.
func e4(t *testing.T) sim.Sector {
	t.Helper()

	s, ok := sim.ParseSector("E4")
	if !ok {
		t.Fatal("no sector E4")
	}

	return s
}

// raided waits for a raid on the sector s's ship is in at (x, y), and its
// Dreadnought's arrival, and returns the warning and the raider.
func raided(
	t *testing.T,
	s *Session,
	tick func(int),
	x, y float32,
) (*pb.RaidWarned, *pb.EnemyState) {
	t.Helper()

	warned, _, _ := raidMessages(t, s, tick, 2*raidEvery+2, x, y)
	if len(warned) != 1 {
		t.Fatalf("%d raid warnings in %d ticks, want one", len(warned), 2*raidEvery+2)
	}
	for range RaidWarnTicks + 2 {
		if d := dreadnoughtIn(must(latest(t, s, tick, 1, x, y))); d != nil {
			return warned[0], d
		}
	}
	t.Fatal("no raider arrived after its warning")

	return nil, nil
}

func TestRaid_ComesOutOfSightInTheHostileSectorAPlayerIsIn(t *testing.T) {
	t.Parallel()

	hub, tick := raidHub(t)
	a, _ := join(t, hub, "a")
	w, d := raided(t, a, tick, enterX, enterY)
	if w.GetSector() != "E4" || w.GetFaction() != pb.EnemyFaction_ENEMY_FACTION_KLAED {
		t.Errorf("raid warning %+v, want the Kla'ed Dreadnought coming to E4", w)
	}
	if !e4(t).Contains(float64(d.GetX()), float64(d.GetY())) {
		t.Errorf("raider at (%v, %v), want it in E4", d.GetX(), d.GetY())
	}
	far := math.Hypot(float64(d.GetX()-enterX), float64(d.GetY()-enterY))
	if far <= sim.DreadnoughtRaidClearance {
		t.Errorf(
			"raider %.0f px from the ship, want it out of sight, past %d",
			far,
			sim.DreadnoughtRaidClearance,
		)
	}
	want := (1 - sim.DreadnoughtRaidShare) * float64(d.GetMaxHp())
	if math.Abs(float64(d.GetLeavesAt())-want) > 1 || d.GetHp() != d.GetMaxHp() {
		t.Errorf("raider %+v, want it whole, driven off at %.0f", d, want)
	}
}

func TestRaid_ComesTenToFifteenMinutesApart(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithMap(emptyMap()), WithClearedSectors(ringOne(1)), WithPoolStart(3))
	a, _ := join(t, hub, "a")
	if warned, _, _ := raidMessages(t, a, tick, RaidEveryMin-1, enterX, enterY); len(warned) != 0 {
		t.Fatalf(
			"raid warnings %v within %d ticks of the first clear, want none",
			warned,
			RaidEveryMin,
		)
	}
	came := false
	for range RaidEveryMax - RaidEveryMin + 2 {
		if warned, _, _ := raidMessages(t, a, tick, 1, enterX, enterY); len(warned) == 1 {
			came = true

			break
		}
	}
	if !came {
		t.Fatalf("no raid by %d ticks after the first clear", RaidEveryMax+1)
	}
	_, ended, _ := raidMessages(t, a, tick, RaidWarnTicks+RaidTicks+2, enterX, enterY)
	if len(ended) != 1 || ended[0].GetDrivenOff() {
		t.Fatalf(
			"raid ends %v by %d ticks after its warning, want it gone once its time was up",
			ended,
			RaidWarnTicks+RaidTicks+2,
		)
	}
	if warned, _, _ := raidMessages(t, a, tick, RaidEveryMin-1, enterX, enterY); len(warned) != 0 {
		t.Errorf(
			"raid warnings %v within %d ticks of the last raid, want none",
			warned,
			RaidEveryMin,
		)
	}
}

func TestRaid_NeverComesBeforeTheRingsFirstClearOrOutsideHostileSectors(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name    string
		cleared []string
		x, y    float32
	}{
		{"nothing cleared", nil, enterX, enterY},
		{"at home", ringOne(1), 0, sim.HomeSpawnY},
		{"in a cleared sector", []string{"E4"}, enterX, enterY},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			hub, tick := testHub(
				t,
				WithMap(emptyMap()),
				WithRaidEvery(raidEvery, raidEvery),
				WithClearedSectors(tc.cleared),
			)
			a, _ := join(t, hub, "a")
			if warned, _, _ := raidMessages(t, a, tick, 4*raidEvery, tc.x, tc.y); len(warned) != 0 {
				t.Errorf("raid warnings %v, want none", warned)
			}
		})
	}
}

func TestRaid_NoneWhileTheGateIsAwakeOrOnceItsFallen(t *testing.T) {
	t.Parallel()

	awake := emptyMap()
	awake.DreadnoughtAwake = true
	gate, tick := testHub(
		t,
		WithMap(awake),
		WithRaidEvery(raidEvery, raidEvery),
		WithClearedSectors(ringOne(1)),
	)
	a, _ := join(t, gate, "a")
	if warned, _, _ := raidMessages(t, a, tick, 4*raidEvery, enterX, enterY); len(warned) != 0 {
		t.Errorf(
			"raid warnings %v with the Kla'ed Dreadnought awake at its gate, want none",
			warned,
		)
	}

	// Ring 2 open: the Kla'ed one fell, so the Nairan one raids ring 2.
	fallen, tick := raidHub(
		t,
		WithOpenRings(2),
		WithClearedSectors(slices.Concat(ringOne(4), ringOf(2, 1))),
	)
	b, _ := join(t, fallen, "b")
	if warned, _, _ := raidMessages(t, b, tick, 4*raidEvery, enterX, enterY); len(warned) != 0 {
		t.Errorf("raid warnings %v in ring 1 once its Dreadnought fell, want none", warned)
	}
	f2 := ringOf(2, 2)[1]
	s, _ := sim.ParseSector(f2)
	c := s.Center()
	w, d := raided(t, b, tick, float32(c.X), float32(c.Y))
	if w.GetFaction() != pb.EnemyFaction_ENEMY_FACTION_NAIRAN ||
		d.GetFaction() != pb.EnemyFaction_ENEMY_FACTION_NAIRAN {
		t.Errorf("raid %+v by %+v in ring 2, want the Nairan Dreadnought", w, d)
	}

	// Every ring open: the finale doesn't raid.
	finale, tick := raidHub(
		t,
		WithOpenRings(3),
		WithClearedSectors(slices.Concat(ringOne(4), ringOf(2, 4), ringOf(3, 1))),
	)
	f, _ := join(t, finale, "f")
	r3, _ := sim.ParseSector(ringOf(3, 2)[1])
	p := r3.Center()
	warned, _, _ := raidMessages(t, f, tick, 4*raidEvery, float32(p.X), float32(p.Y))
	if len(warned) != 0 {
		t.Errorf("raid warnings %v with every ring open, want none", warned)
	}
}

// hitRaider hits d n times from player s.
func hitRaider(s *Session, d *pb.EnemyState, n int) {
	for shot := range uint32(n) { //nolint:gosec // a few shots.
		hitFrigate(s, d.GetEnemyId(), 1000+shot)
	}
}

func TestRaid_DrivenOffByATenthOfItsHealthGivesThoseNearAPart(t *testing.T) {
	t.Parallel()

	saves := &saved{}
	hub, tick := raidHub(t, WithDreadnought(sim.Klaed, 0.5), WithSaveDreadnought(saves.share))
	a, _ := join(t, hub, "a")
	far, _ := join(t, hub, "far")
	_, d := raided(t, a, tick, enterX, enterY)
	x, y := d.GetX(), d.GetY()+300
	far.Send(state(0, sim.HomeSpawnY))
	must(latest(t, a, tick, 1, x, y))
	drain(far)

	// A tenth of its health, behind its shield, and a little more.
	n := int(
		math.Ceil(
			(sim.DreadnoughtRaidShare*float64(d.GetMaxHp())+sim.DreadnoughtShield)/MaxHitDamage,
		),
	) + 2
	hitRaider(a, d, n)
	_, ended, snap := raidMessages(t, a, tick, 2, x, y)
	if len(ended) != 1 || !ended[0].GetDrivenOff() || ended[0].GetEnemyId() != d.GetEnemyId() {
		t.Fatalf("raid ends %v, want it driven off", ended)
	}
	if dreadnoughtIn(snap) != nil {
		t.Error("the raider still in the world once driven off")
	}
	got := map[string]bool{}
	for _, g := range ended[0].GetGains() {
		got[g.GetPlayerId()] = true
	}
	if !got["a"] || got["far"] {
		t.Errorf("parts went to %v, want the player near it and not the one far away", got)
	}
	left := func(shares []float64, _ []int) bool {
		return slices.ContainsFunc(shares, func(s float64) bool { return s <= 0.4 && s > 0.38 })
	}
	if shares, _ := saves.settle(left); !left(shares, nil) {
		t.Errorf("saved shares %v, want about 0.4 left", shares)
	}
}

func TestRaid_LeavesWhenItsTimeIsUp(t *testing.T) {
	t.Parallel()

	hub, tick := raidHub(t)
	a, _ := join(t, hub, "a")
	_, d := raided(t, a, tick, enterX, enterY)
	_, ended, snap := raidMessages(t, a, tick, RaidTicks+1, enterX, enterY)
	if len(ended) != 1 || ended[0].GetDrivenOff() || len(ended[0].GetGains()) != 0 ||
		ended[0].GetEnemyId() != d.GetEnemyId() {
		t.Errorf("raid ends %v, want it gone, not driven off, once its time was up", ended)
	}
	if dreadnoughtIn(snap) != nil {
		t.Error("the raider still in the world after its time")
	}
}

func TestRaid_LeavesWhenEveryoneNearIsDown(t *testing.T) {
	t.Parallel()

	hub, tick := raidHub(t)
	a, _ := join(t, hub, "a")
	_, d := raided(t, a, tick, enterX, enterY)
	x, y := d.GetX(), d.GetY()+300
	if _, ended, _ := raidMessages(t, a, tick, 5, x, y); len(ended) != 0 {
		t.Fatalf("raid ends %v with a ship up near it, want it staying", ended)
	}
	a.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_State{State: &pb.ShipState{
		X: x, Y: y, Damage: sim.MaxDamage,
	}}})
	tick(1)
	for {
		if e := next(t, a).GetRaidEnded(); e != nil {
			if e.GetDrivenOff() {
				t.Errorf("raid end %+v, want it leaving, not driven off", e)
			}

			return
		}
	}
}

func TestRaid_EndsWhenItsDreadnoughtWakesAtTheGate(t *testing.T) {
	t.Parallel()

	// E4's garrison of one is all that stands between ring 1 and its fourth
	// cleared sector.
	cleared := slices.DeleteFunc(ringOne(6), func(n string) bool { return n == "E4" })[:3]
	m := emptyMap()
	m.Garrisons["E4"] = 1
	hub, tick := testHub(
		t,
		WithMap(m),
		WithRaidEvery(raidEvery, raidEvery),
		WithClearedSectors(cleared),
		WithDreadnought(sim.Klaed, 0.7),
	)
	a, _ := join(t, hub, "a")
	_, raider := raided(t, a, tick, enterX, enterY)
	hitRaider(a, raider, 20)
	var guard *pb.EnemyState
	snap := must(latest(t, a, tick, 1, enterX, enterY))
	for _, e := range snap.GetEnemies() {
		if e.GetKind() != pb.EnemyKind_ENEMY_KIND_DREADNOUGHT {
			guard = e
		}
	}
	hurt := dreadnoughtIn(snap).GetHp()
	if hurt >= raider.GetHp() {
		t.Fatalf("raider at %v after 20 hits, want it hurt from %v", hurt, raider.GetHp())
	}
	if guard == nil {
		t.Fatal("no garrison in E4 beside the raider")
	}
	hitRaider(a, guard, 1)
	_, ended, snap := raidMessages(t, a, tick, 3, enterX, enterY)
	// The gate one wakes with the share the raid left it.
	if gate := dreadnoughtIn(snap); math.Abs(float64(gate.GetHp()-hurt)) > 2 {
		t.Errorf("the gate Dreadnought's hp = %v, want the raider's %v", gate.GetHp(), hurt)
	}
	if len(ended) != 1 || ended[0].GetEnemyId() != raider.GetEnemyId() || ended[0].GetDrivenOff() {
		t.Errorf("raid ends %v once ring 1 had 4 cleared, want the raid called off", ended)
	}
	gate := dreadnoughtIn(snap)
	s, _ := sim.SectorAt(float64(gate.GetX()), float64(gate.GetY()))
	if gate == nil || gate.GetEnemyId() == raider.GetEnemyId() || s.Ring() != 2 ||
		gate.GetLeavesAt() != 0 {
		t.Errorf(
			"Dreadnought %+v once ring 1 had 4 cleared, want the gate one awake in ring 2",
			gate,
		)
	}
}

func TestRaid_ADevelopmentServerSendsOneOnRequest(t *testing.T) {
	t.Parallel()

	for _, dev := range []bool{true, false} {
		opts := []HubOption{WithMap(emptyMap())}
		if dev {
			opts = append(opts, WithDevelopment())
		}
		hub, tick := testHub(t, opts...)
		a, _ := join(t, hub, "a")
		must(latest(t, a, tick, 1, enterX, enterY))
		a.Send(
			&pb.ClientMessage{
				Kind: &pb.ClientMessage_DevStartRaid{DevStartRaid: &pb.DevStartRaid{}},
			},
		)
		if warned, _, _ := raidMessages(t, a, tick, 2, enterX, enterY); (len(warned) == 1) != dev {
			t.Errorf("development %t: %d raids sent on request", dev, len(warned))
		}
	}
}
