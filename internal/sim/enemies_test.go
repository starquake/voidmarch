package sim_test

import (
	"math"
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
		{EnemyFrigate, Klaed, 19},
		{EnemyFrigate, Nairan, 21},
		{EnemyFrigate, Nautolan, 20},
		{EnemySupport, Klaed, 14},
		{EnemySupport, Nairan, 15},
		{EnemySupport, Nautolan, 16},
	}
	for _, tc := range tests {
		if got := EnemyRadius(tc.kind, tc.faction); got != tc.want {
			t.Errorf("EnemyRadius(%s, %s) = %v, want %v", tc.kind, tc.faction, got, tc.want)
		}
	}
}

func TestLeadAngle_MeetsAMovingTarget(t *testing.T) {
	t.Parallel()

	const speed, delay = 150.0, 0.3
	tests := []struct {
		name           string
		tx, ty, vx, vy float64
	}{
		{"still", 200, 0, 0, 0},
		{"crossing", 200, 0, 0, 80},
		{"closing", 200, 100, -60, -20},
		{"fleeing", 0, 250, 30, 90},
	}
	for _, tc := range tests {
		angle := LeadAngle(0, 0, tc.tx, tc.ty, tc.vx, tc.vy, speed, delay)
		// Fly both forward and find the closest they come.
		closest := math.Inf(1)
		for step := range 800 {
			ft := float64(step) / 100
			sx, sy := speed*ft*math.Cos(angle), speed*ft*math.Sin(angle)
			px, py := tc.tx+tc.vx*(ft+delay), tc.ty+tc.vy*(ft+delay)
			closest = math.Min(closest, math.Hypot(sx-px, sy-py))
		}
		if closest > 2 {
			t.Errorf(
				"%s: a shot along %.3f passes %.1f px from the target, want it to meet it",
				tc.name,
				angle,
				closest,
			)
		}
	}
	if got, want := LeadAngle(0, 0, 100, 0, 500, 0, 100, 0), 0.0; got != want {
		t.Errorf(
			"LeadAngle() at a target too fast to catch = %v, want straight at it, %v",
			got,
			want,
		)
	}
}

func TestFactionSmarts(t *testing.T) {
	t.Parallel()

	if (FactionSmarts(Klaed) != Smarts{}) {
		t.Errorf("the Kla'ed have %+v, want none", FactionSmarts(Klaed))
	}
	if got := FactionSmarts(Nairan); !got.Lead || !got.Flank || got.Dodge || got.PickWeak {
		t.Errorf("the Nairan have %+v, want leading and flanking", got)
	}
	all := Smarts{Lead: true, Flank: true, Dodge: true, PickWeak: true}
	if got := FactionSmarts(Nautolan); got != all {
		t.Errorf("the Nautolan have %+v, want all four", got)
	}
}

func TestFrigateRing_EachFactionRingsWithItsOwnShotsAndMoreOfThem(t *testing.T) {
	t.Parallel()

	tests := []struct {
		faction EnemyFaction
		bullet  EnemyBulletID
		count   int
	}{
		{Klaed, KlaedBigBullet, FrigateRingBullets},
		{Nairan, NairanRay, 18},
		{Nautolan, NautolanSpinningBullet, 24},
	}
	for _, tc := range tests {
		bullet, count := FrigateRing(tc.faction)
		if bullet != tc.bullet || count != tc.count || count > MaxVolleyBullets {
			t.Errorf(
				"FrigateRing(%s) = %s x %d, want %s x %d, at most %d",
				tc.faction,
				bullet,
				count,
				tc.bullet,
				tc.count,
				MaxVolleyBullets,
			)
		}
		ring := EnemyPattern(EnemyFrigate, tc.faction, 0, 0, 0, 7)
		if len(ring) != tc.count || ring[0].Kind != ProjectileKind(tc.bullet) {
			t.Errorf(
				"a %s Frigate's ring = %d of %s, want %d of %s",
				tc.faction,
				len(ring),
				ring[0].Kind,
				tc.count,
				tc.bullet,
			)
		}
	}
}
