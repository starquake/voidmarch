package sim_test

import (
	"math"
	"reflect"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

// flown is spawn fired from the pool and aged by age seconds.
func flown(spawn ProjectileSpawn, age float64) *Projectile {
	pool := NewPool(1)
	p := pool.Spawn(spawn, SpawnOptions{Faction: FactionEnemy})
	p.Age = age
	Place(p)

	return p
}

func TestEnemyPattern_ABomberPairCrossesWhereItAimed(t *testing.T) {
	t.Parallel()

	for _, faction := range EnemyFactions() {
		const angle = 0.7
		pair := EnemyPattern(EnemyBomber, faction, 100, 50, angle, 3)
		if len(pair) != 2 ||
			!reflect.DeepEqual(pair, EnemyPattern(EnemyBomber, faction, 100, 50, angle, 99)) {
			t.Fatalf("%s Bomber: %+v, want the same two shots whatever the seed", faction, pair)
		}
		stats := ProjectileStatsOf(pair[0].Kind)
		age := BomberConverge * math.Cos(BomberSplay) / stats.Speed
		a, b := flown(pair[0], age), flown(pair[1], age)
		if d := math.Hypot(a.X-b.X, a.Y-b.Y); d > 1 {
			t.Errorf("%s: the shots are %.1f px apart where they should cross", faction, d)
		}
		// Measured from the muzzle, the crossing is BomberConverge down the aim.
		along := (a.X-pair[0].X)*math.Cos(angle) + (a.Y-pair[0].Y)*math.Sin(angle)
		off := -(a.X-100)*math.Sin(angle) + (a.Y-50)*math.Cos(angle)
		if math.Abs(along-BomberConverge) > 3 || math.Abs(off) > 3 {
			t.Errorf(
				"%s: they cross %.0f along the aim and %.0f off it, want %d and 0",
				faction,
				along,
				off,
				BomberConverge,
			)
		}
		start, there := HeadingAt(a, 0), HeadingAt(a, age)
		if math.Abs(WrapAngle(there-angle)) >= math.Abs(WrapAngle(start-angle)) {
			t.Errorf(
				"%s: heading %v, then %v where they cross, want it turned in toward %v",
				faction,
				start,
				there,
				angle,
			)
		}
	}
}

func TestEnemyPattern_ATorpedoGoesStraightDownItsLine(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		faction EnemyFaction
		want    EnemyBulletID
	}{{Klaed, KlaedTorpedo}, {Nairan, NairanTorpedo}, {Nautolan, NautolanWave}} {
		shots := EnemyPattern(EnemyTorpedo, tc.faction, 0, 0, 1, 5)
		if len(shots) != 1 || shots[0].Kind != ProjectileKind(tc.want) || shots[0].Angle != 1 ||
			shots[0].Curve != 0 {
			t.Errorf(
				"%s Torpedo Ship fires %+v, want one straight %s along 1",
				tc.faction,
				shots,
				tc.want,
			)
		}
		if got := HitSteps(shots[0].Kind); got != TorpedoHitSteps {
			t.Errorf("a %s takes %d hull steps, want %d", tc.want, got, TorpedoHitSteps)
		}
	}
	for _, kind := range []EnemyBulletID{KlaedBullet, KlaedBigBullet, NairanRocket, NautolanBomb} {
		if got := HitSteps(ProjectileKind(kind)); got != 1 {
			t.Errorf("a %s takes %d hull steps, want 1", kind, got)
		}
	}
}

func TestHeadingAt_AStraightShotKeepsItsAngle(t *testing.T) {
	t.Parallel()

	p := flown(ProjectileSpawn{Kind: ProjectileKind(KlaedBullet), Angle: 2}, 1)
	if got := HeadingAt(p, 1); got != 2 {
		t.Errorf("HeadingAt() = %v, want 2", got)
	}
}

func TestEnemyBullet_EachFactionsHeaviesFireItsOwnShots(t *testing.T) {
	t.Parallel()

	tests := []struct {
		faction         EnemyFaction
		bomber, torpedo EnemyBulletID
	}{
		{Klaed, KlaedBigBullet, KlaedTorpedo},
		{Nairan, NairanRocket, NairanTorpedo},
		{Nautolan, NautolanBomb, NautolanWave},
	}
	for _, tc := range tests {
		if got := EnemyBullet(EnemyBomber, tc.faction); got != tc.bomber {
			t.Errorf("a %s Bomber fires %s, want %s", tc.faction, got, tc.bomber)
		}
		if got := EnemyBullet(EnemyTorpedo, tc.faction); got != tc.torpedo {
			t.Errorf("a %s Torpedo Ship fires %s, want %s", tc.faction, got, tc.torpedo)
		}
		pair := EnemyPattern(EnemyBomber, tc.faction, 0, 0, 0, 1)
		if len(pair) != 2 || pair[0].Kind != ProjectileKind(tc.bomber) ||
			pair[1].Kind != ProjectileKind(tc.bomber) {
			t.Errorf("a %s Bomber's pair = %+v, want two %s", tc.faction, pair, tc.bomber)
		}
	}
}

func TestGarrisonHeavyShare(t *testing.T) {
	t.Parallel()

	if got := GarrisonHeavyShare(0); got != 0 {
		t.Errorf("GarrisonHeavyShare(0) = %v, want none at home", got)
	}
	// A few in ring 1, at Kla'ed strength (#185).
	if got := GarrisonHeavyShare(1); got < 0.05 || got > 0.15 {
		t.Errorf("GarrisonHeavyShare(1) = %v, want about 0.1", got)
	}
	if GarrisonHeavyShare(2) <= GarrisonHeavyShare(1) ||
		GarrisonHeavyShare(3) <= GarrisonHeavyShare(2) {
		t.Errorf(
			"heavy shares %v, %v, %v by ring, want more outward",
			GarrisonHeavyShare(1),
			GarrisonHeavyShare(2),
			GarrisonHeavyShare(3),
		)
	}
}
