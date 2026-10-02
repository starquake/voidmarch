package sim_test

import (
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

func TestFactionOfRing(t *testing.T) {
	t.Parallel()

	tests := []struct {
		ring int
		want EnemyFaction
	}{
		{0, Klaed},
		{1, Klaed},
		{2, Nairan},
		{3, Nautolan},
	}
	for _, tc := range tests {
		if got := FactionOfRing(tc.ring); got != tc.want {
			t.Errorf("FactionOfRing(%d) = %q, want %q", tc.ring, got, tc.want)
		}
	}
}

func TestFactionStats_EachFactionTougherThanTheLast(t *testing.T) {
	t.Parallel()

	if got := FactionStats(Klaed); got != (FactionStat{Health: 1, Shots: 1}) {
		t.Errorf("FactionStats(Klaed) = %+v, want the Kla'ed as they are", got)
	}
	factions := EnemyFactions()
	for i := 1; i < len(factions); i++ {
		was, is := FactionStats(factions[i-1]), FactionStats(factions[i])
		if is.Health <= was.Health || is.Shots <= was.Shots {
			t.Errorf("%s %+v, want tougher than %s %+v", factions[i], is, factions[i-1], was)
		}
	}
}

func TestEnemyBulletStatsOf_LaterFactionsShootFasterWithTheSameReach(t *testing.T) {
	t.Parallel()

	for _, kind := range []EnemyKind{EnemyScout, EnemyFighter} {
		klaed := EnemyBulletStatsOf(EnemyBullet(kind, Klaed))
		reach := klaed.Speed * klaed.Lifetime
		for _, faction := range []EnemyFaction{Nairan, Nautolan} {
			s := EnemyBulletStatsOf(EnemyBullet(kind, faction))
			if s.Speed <= klaed.Speed {
				t.Errorf(
					"%s %s shot at %v px/s, want faster than the Kla'ed %v",
					faction,
					kind,
					s.Speed,
					klaed.Speed,
				)
			}
			if got := s.Speed * s.Lifetime; got < reach*0.95 || got > reach*1.05 {
				t.Errorf(
					"%s %s shot reaches %v px, want about the Kla'ed %v",
					faction,
					kind,
					got,
					reach,
				)
			}
		}
	}
}

func TestEnemyRadius_FollowsEachFactionsHull(t *testing.T) {
	t.Parallel()

	tests := []struct {
		kind    EnemyKind
		faction EnemyFaction
		want    float64
	}{
		{EnemyScout, Klaed, 11},
		{EnemyFighter, Klaed, 12},
		{EnemyScout, Nairan, 11},
		{EnemyFighter, Nairan, 14},
		{EnemyScout, Nautolan, 15},
		{EnemyFighter, Nautolan, 15},
		{EnemyFrigate, Nautolan, 19},
	}
	for _, tc := range tests {
		if got := EnemyRadius(tc.kind, tc.faction); got != tc.want {
			t.Errorf("EnemyRadius(%s, %s) = %v, want %v", tc.kind, tc.faction, got, tc.want)
		}
	}
}
