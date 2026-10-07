package game_test

import (
	"fmt"
	"math"
	"slices"
	"testing"

	"google.golang.org/protobuf/proto"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
	"github.com/starquake/voidmarch/internal/world"
)

func TestVolleyRange_InsideInterest(t *testing.T) {
	t.Parallel()

	// A volley the hub flies for a companion comes from an enemy its owner is sent.
	if got, limit := VolleyRange+WarningTravel(), float64(sim.InterestRadius); got >= limit {
		t.Errorf(
			"VolleyRange + WarningTravel() = %v, should stay under sim.InterestRadius %v",
			got,
			limit,
		)
	}
}

// at is where a session's ship is for one tick of stepAll.
type at struct {
	s    *Session
	x, y float32
}

// stepAll reports each ship where it is, steps the hub one tick and returns
// each session's snapshot of it, in order.
func stepAll(t *testing.T, tick func(int), ships ...at) []*pb.Snapshot {
	t.Helper()

	for _, ship := range ships {
		ship.s.Send(state(ship.x, ship.y))
	}
	tick(1)
	snaps := make([]*pb.Snapshot, len(ships))
	for i, ship := range ships {
		for snaps[i] == nil {
			snaps[i] = next(t, ship.s).GetSnapshot()
		}
	}

	return snaps
}

// enemyIDs are the ids of the enemies in snap, in its order.
func enemyIDs(snap *pb.Snapshot) []uint32 {
	ids := make([]uint32, 0, len(snap.GetEnemies()))
	for _, e := range snap.GetEnemies() {
		ids = append(ids, e.GetEnemyId())
	}

	return ids
}

// scoutAt is a Kla'ed Scout at (x, y) on a map with no garrisons.
func scoutAt(x, y float64) HubOption {
	return WithEnemyOf(pb.EnemyKind_ENEMY_KIND_SCOUT, sim.Klaed, x, y)
}

// interestHub is a hub with no garrisons or events, so its enemies are
// the ones a test puts there.
func interestHub(t *testing.T, opts ...HubOption) (*Hub, func(int)) {
	t.Helper()

	return testHub(t, append([]HubOption{WithMap(emptyMap()), NoEvents}, opts...)...)
}

func TestInterest_SendsTheEnemiesInRange(t *testing.T) {
	t.Parallel()

	hub, tick := interestHub(t, scoutAt(0, -1600))
	beside, _ := join(t, hub, "beside")
	near, _ := join(t, hub, "near")
	far, _ := join(t, hub, "far")
	snaps := stepAll(t, tick,
		at{beside, 0, -1500},
		at{near, 1000, -1600},
		at{far, 2000, -1600},
	)

	if got, want := enemyIDs(snaps[1]), []uint32{1}; !slices.Equal(got, want) {
		t.Errorf("enemies 1000 px away = %v, want %v", got, want)
	}
	if got := enemyIDs(snaps[2]); len(got) != 0 {
		t.Errorf("enemies 2000 px away = %v, want none", got)
	}
}

func TestInterest_EachMemberGetsTheirOwn(t *testing.T) {
	t.Parallel()

	hub, tick := interestHub(t, scoutAt(-2000, 0), scoutAt(2000, 0))
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")
	snaps := stepAll(t, tick, at{a, -2000, 300}, at{b, 2000, 300})

	if got, want := enemyIDs(snaps[0]), []uint32{1}; !slices.Equal(got, want) {
		t.Errorf("a's enemies = %v, want %v", got, want)
	}
	if got, want := enemyIDs(snaps[1]), []uint32{2}; !slices.Equal(got, want) {
		t.Errorf("b's enemies = %v, want %v", got, want)
	}
}

func TestInterest_KeepsAnEnemyUntilItsPastTheMargin(t *testing.T) {
	t.Parallel()

	hub, tick := interestHub(t, scoutAt(0, -1600))
	beside, _ := join(t, hub, "beside")
	a, _ := join(t, hub, "a")
	// The Scout roams around the ship beside it, so a keeps its distance
	// from where the Scout was last.
	ex, ey := float32(0), float32(-1600)
	for _, tc := range []struct {
		distance float32
		want     bool
		why      string
	}{
		{sim.InterestRadius + 300, false, "out of range"},
		{sim.InterestRadius - 100, true, "inside the radius"},
		{sim.InterestRadius + 100, true, "inside the margin, once sent"},
		{sim.InterestRadius + sim.InterestMargin + 100, false, "past the margin"},
		{sim.InterestRadius + 100, false, "inside the margin, once dropped"},
		{sim.InterestRadius - 100, true, "inside the radius again"},
	} {
		snaps := stepAll(t, tick, at{beside, 0, -1500}, at{a, ex + tc.distance, ey})
		if got := slices.Contains(enemyIDs(snaps[1]), 1); got != tc.want {
			t.Errorf("enemy sent %v %.0f px away, %s; want %v", got, tc.distance, tc.why, tc.want)
		}
		scout := snaps[0].GetEnemies()[0]
		ex, ey = scout.GetX(), scout.GetY()
	}
}

func TestInterest_BossesReachEveryone(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name string
		m    *world.Map
		boss pb.EnemyKind
	}{
		{"the Frigate", frigateMap, pb.EnemyKind_ENEMY_KIND_FRIGATE},
		{
			"an awake Dreadnought",
			&world.Map{Name: "test", DreadnoughtAwake: true, NoEvents: true},
			pb.EnemyKind_ENEMY_KIND_DREADNOUGHT,
		},
	} {
		hub, tick := testHub(t, WithMap(tc.m), NoEvents)
		a, _ := join(t, hub, "a")
		snaps := stepAll(t, tick, at{a, 0, 180})
		if !slices.ContainsFunc(snaps[0].GetEnemies(), func(e *pb.EnemyState) bool {
			return e.GetKind() == tc.boss
		}) {
			t.Errorf("%s isn't sent to a player at home", tc.name)
		}
		for _, e := range snaps[0].GetEnemies() {
			d := math.Hypot(float64(e.GetX()), float64(e.GetY()-180))
			if e.GetKind() != tc.boss && d > sim.InterestRadius {
				t.Errorf(
					"%s's %s %.0f px away is sent too, want bosses only",
					tc.name,
					e.GetKind(),
					d,
				)
			}
		}
	}
}

func TestInterest_ACompanionExtendsTheRange(t *testing.T) {
	t.Parallel()

	hub, tick := interestHub(t, scoutAt(0, -500))
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	grant(t, a)
	snaps := stepAll(t, tick, at{a, 3000, 0})

	if !slices.Contains(enemyIDs(snaps[0]), 1) {
		t.Errorf(
			"enemies = %v with the companion at home and the player 3000 px out, want the one near home",
			enemyIDs(snaps[0]),
		)
	}
}

func TestInterest_BeforeItsFirstStateAMemberGetsTheEnemiesNearItsSpawn(t *testing.T) {
	t.Parallel()

	hub, tick := interestHub(t, scoutAt(0, 900), scoutAt(0, 2500))
	a, w := join(t, hub, "a")
	tick(1)
	var snap *pb.Snapshot
	for snap == nil {
		snap = next(t, a).GetSnapshot()
	}

	if math.Hypot(float64(w.GetSpawnX()), float64(w.GetSpawnY()-180)) > 1 {
		t.Fatalf("spawned at (%v, %v), want below home at (0, 180)", w.GetSpawnX(), w.GetSpawnY())
	}
	if got, want := enemyIDs(snap), []uint32{1}; !slices.Equal(got, want) {
		t.Errorf("enemies before the first state = %v, want %v, the one near the spawn", got, want)
	}
}

// The issue's measured world (#231): 16 players in four groups of four, at
// sector centers in ring 2, and 386 enemies over the other sectors.
const (
	benchmarkGroups    = 4
	benchmarkGroupSize = 4
	benchmarkEnemies   = 386
	benchmarkSpread    = 700
	goldenAngle        = 2.39996
)

// BenchmarkHub_SnapshotBytes measures the snapshots one tick sends, with
// every enemy sent to everyone as before #231 and with interest management.
func BenchmarkHub_SnapshotBytes(b *testing.B) {
	for _, bc := range []struct {
		name string
		opts []HubOption
	}{
		{"every-enemy", []HubOption{WithEveryEnemy()}},
		{"interest", nil},
	} {
		b.Run(bc.name, func(b *testing.B) {
			msgs := benchmarkSnapshots(b, bc.opts...)
			var total int
			for b.Loop() {
				total = 0
				for _, msg := range msgs {
					wire, err := proto.Marshal(msg)
					if err != nil {
						b.Fatalf("proto.Marshal() error = %v", err)
					}
					total += len(wire)
				}
			}
			perClient := float64(total) / float64(len(msgs))
			b.ReportMetric(perClient, "B/snapshot")
			b.ReportMetric(perClient*TickRate/1024, "KiB/s/client")
		})
	}
}

// benchmarkSnapshots steps the benchmark's world one tick and returns the
// snapshot each player got.
func benchmarkSnapshots(b *testing.B, opts ...HubOption) []*pb.ServerMessage {
	b.Helper()

	var ring2 []sim.Sector
	for _, s := range sim.Sectors() {
		if s.Ring() == 2 {
			ring2 = append(ring2, s)
		}
	}
	groups := make([]sim.Sector, 0, benchmarkGroups)
	for i := range benchmarkGroups {
		groups = append(groups, ring2[i*len(ring2)/benchmarkGroups])
	}
	others := slices.DeleteFunc(sim.Sectors(), func(s sim.Sector) bool {
		return s == sim.HomeSector() || slices.Contains(groups, s)
	})
	for i := range benchmarkEnemies {
		c := others[i%len(others)].Center()
		r := benchmarkSpread * math.Sqrt(float64(i)/benchmarkEnemies)
		a := float64(i) * goldenAngle
		opts = append(opts, scoutAt(c.X+r*math.Cos(a), c.Y+r*math.Sin(a)))
	}
	hub, tick := testHub(b, append([]HubOption{WithMap(emptyMap()), WithOpenRings(3)}, opts...)...)

	ships := make([]at, 0, benchmarkGroups*benchmarkGroupSize)
	for g, s := range groups {
		c := s.Center()
		for p := range benchmarkGroupSize {
			session, _ := join(b, hub, fmt.Sprintf("p%d-%d", g, p))
			ships = append(ships, at{session, float32(c.X) + float32(p*40), float32(c.Y)})
		}
	}
	for _, ship := range ships {
		drain(ship.s)
		ship.s.Send(state(ship.x, ship.y))
	}
	tick(1)
	msgs := make([]*pb.ServerMessage, 0, len(ships))
	for _, ship := range ships {
		for {
			if msg := next(b, ship.s); msg.GetSnapshot() != nil {
				msgs = append(msgs, msg)

				break
			}
		}
	}

	return msgs
}
