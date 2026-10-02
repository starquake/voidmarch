package game_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

func TestGarrison_EachRingHoldsItsFaction(t *testing.T) {
	t.Parallel()

	tests := []struct {
		sector string
		want   pb.EnemyFaction
	}{
		{"E4", pb.EnemyFaction_ENEMY_FACTION_KLAED},
		{"D2", pb.EnemyFaction_ENEMY_FACTION_NAIRAN},
		{"D1", pb.EnemyFaction_ENEMY_FACTION_NAUTOLAN},
	}
	for _, tc := range tests {
		s, _ := sim.ParseSector(tc.sector)
		c := s.Center()
		hub, tick := testHub(t, WithOpenRings(3), NoEvents)
		a, _ := join(t, hub, "a")
		var fired *pb.EnemyFired
		snap := must(latest(t, a, tick, 1, float32(c.X), float32(c.Y)))
		for range 10 * TickRate {
			if fired != nil {
				break
			}
			_, others := latest(t, a, tick, 1, float32(c.X), float32(c.Y))
			for _, msg := range others {
				if f := msg.GetEnemyFired(); f != nil {
					fired = f
				}
			}
		}
		in := 0
		for _, e := range snap.GetEnemies() {
			if !s.Contains(float64(e.GetX()), float64(e.GetY())) {
				continue
			}
			in++
			if e.GetFaction() != tc.want {
				t.Errorf(
					"%s: enemy %d is %v, want %v",
					tc.sector,
					e.GetEnemyId(),
					e.GetFaction(),
					tc.want,
				)
			}
		}
		if in == 0 {
			t.Errorf("%s: no garrison took the field", tc.sector)
		}
		if fired.GetFaction() != tc.want {
			t.Errorf("%s: a volley came from %v, want %v", tc.sector, fired.GetFaction(), tc.want)
		}
	}
}

func TestEnemyStats_LaterFactionsAreTougherAndFireMoreOften(t *testing.T) {
	t.Parallel()

	for _, kind := range []pb.EnemyKind{pb.EnemyKind_ENEMY_KIND_SCOUT, pb.EnemyKind_ENEMY_KIND_FIGHTER} {
		hp, every := EnemyStatsFor(kind, sim.Klaed)
		for _, faction := range []sim.EnemyFaction{sim.Nairan, sim.Nautolan} {
			tougher := sim.FactionStats(faction)
			gotHP, gotEvery := EnemyStatsFor(kind, faction)
			wantHP := float64(hp) * tougher.Health
			if math.Abs(float64(gotHP)-wantHP) > 0.5 {
				t.Errorf("%s %v: %d hp, want about %v", faction, kind, gotHP, wantHP)
			}
			wantEvery := float64(every) / tougher.Shots
			if math.Abs(float64(gotEvery)-wantEvery) > 0.5 {
				t.Errorf(
					"%s %v: fires every %d ticks, want about %v",
					faction,
					kind,
					gotEvery,
					wantEvery,
				)
			}
		}
	}
}
