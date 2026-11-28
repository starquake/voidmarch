package game_test

import (
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
	"github.com/starquake/voidmarch/internal/world"
)

// simFaction is a faction off the wire.
func simFaction(f pb.EnemyFaction) sim.EnemyFaction {
	switch f {
	case pb.EnemyFaction_ENEMY_FACTION_NAIRAN:
		return sim.Nairan
	case pb.EnemyFaction_ENEMY_FACTION_NAUTOLAN:
		return sim.Nautolan
	case pb.EnemyFaction_ENEMY_FACTION_KLAED, pb.EnemyFaction_ENEMY_FACTION_UNSPECIFIED:
		fallthrough
	default:
		return sim.Klaed
	}
}

// bossHitsAt parks a ship gap px out from the hull of the boss of faction
// that find picks from each snapshot, straight below it, for seconds, and
// counts the boss's bullets that meet it, as the client tests its own ship
// (ShipScan): every EnemyFired of the boss expanded by sim.EnemyPattern and
// stepped at the sim's rate against sim.FirstShipHit. The ship has no shield
// charge, so every contact counts.
func bossHitsAt(
	t *testing.T,
	m *world.Map,
	kind pb.EnemyKind,
	faction sim.EnemyFaction,
	find func(*pb.Snapshot) *pb.EnemyState,
	gap float64,
	seconds int,
) int {
	t.Helper()

	hub, tick := testHub(t, WithEveryEnemy(), WithMap(m), NoEvents)
	s, _ := join(t, hub, "a")
	boss := find(must(latest(t, s, tick, 1, 0, 0)))
	if boss == nil {
		t.Fatalf("no %v in the snapshot", kind)
	}
	if got := simFaction(boss.GetFaction()); got != faction {
		t.Fatalf("%v of faction %q, want %q", kind, got, faction)
	}
	reach := sim.EnemyRadius(SimEnemyKind(kind), faction) + sim.ShipRadius + gap

	const pool, steps = 1024, sim.TickRate / TickRate
	const step = 1.0 / sim.TickRate
	bullets := sim.NewPool(pool)
	everywhere := func(_, _ float64) bool { return true }
	hits := 0
	for range seconds * TickRate {
		x, y := float64(boss.GetX()), float64(boss.GetY())+reach
		snap, others := latest(t, s, tick, 1, float32(x), float32(y))
		if b := find(snap); b != nil {
			boss = b
		}
		for _, msg := range others {
			f := msg.GetEnemyFired()
			if f == nil || f.GetKind() != kind {
				continue
			}
			for _, b := range sim.EnemyPattern(
				SimEnemyKind(kind), simFaction(f.GetFaction()),
				float64(f.GetX()), float64(f.GetY()), float64(f.GetAngle()), f.GetSeed(),
			) {
				bullets.Spawn(b, sim.SpawnOptions{Faction: sim.FactionEnemy})
			}
		}
		ship := []sim.ShipTarget{{X: x, Y: y, Shield: sim.ShieldFront}}
		for range steps {
			bullets.Step(step, everywhere)
			items := bullets.Items()
			for i := range items {
				p := &items[i]
				if !p.Active {
					continue
				}
				from := sim.PositionAt(p, max(0, p.Age-step))
				if _, _, ok := sim.FirstShipHit(ship, from.X, from.Y, p.X, p.Y); ok {
					p.Active = false
					hits++
				}
			}
		}
	}

	return hits
}

func TestBoss_HullIsNoSafeSpot(t *testing.T) {
	t.Parallel()

	const (
		away    = 200
		seconds = 20
	)
	tests := []struct {
		name    string
		m       *world.Map
		kind    pb.EnemyKind
		faction sim.EnemyFaction
		find    func(*pb.Snapshot) *pb.EnemyState
	}{
		{
			name:    "Frigate",
			m:       frigateMap,
			kind:    pb.EnemyKind_ENEMY_KIND_FRIGATE,
			faction: sim.Klaed,
			find:    frigateIn,
		},
		{
			name:    "Kla'ed Dreadnought",
			m:       &world.Map{Name: "test", DreadnoughtAwake: true, NoEvents: true},
			kind:    pb.EnemyKind_ENEMY_KIND_DREADNOUGHT,
			faction: sim.Klaed,
			find:    dreadnoughtIn,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			touching := bossHitsAt(t, tc.m, tc.kind, tc.faction, tc.find, 0, seconds)
			far := bossHitsAt(t, tc.m, tc.kind, tc.faction, tc.find, away, seconds)
			t.Logf("%s: %d hits against the hull, %d at %d px, in %d s",
				tc.name, touching, far, away, seconds)
			if touching == 0 || touching < far {
				t.Errorf(
					"%s hit a ship against its hull %d times in %d s and one %d px out %d times, "+
						"want the hull no safer (see #354)",
					tc.name, touching, seconds, away, far,
				)
			}
		})
	}
}
