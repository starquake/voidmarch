package sim_test

import (
	"math"
	"reflect"
	"slices"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

func TestEnemyPattern_SameSeedSameBullets(t *testing.T) {
	t.Parallel()

	a := EnemyPattern(
		EnemyScout, Klaed, 10, 20, 1, 42)
	b := EnemyPattern(
		EnemyScout, Klaed, 10, 20, 1, 42)
	if !reflect.DeepEqual(a, b) {
		t.Errorf("same seed: %+v != %+v", a, b)
	}
}

func TestEnemyPattern_EachEnemyItsOwnBullet(t *testing.T) {
	t.Parallel()

	tests := []struct {
		kind    EnemyKind
		faction EnemyFaction
		want    EnemyBulletID
	}{
		{EnemyScout, Klaed, KlaedBullet},
		{EnemyFighter, Klaed, KlaedBigBullet},
		{EnemyScout, Nairan, NairanBolt},
		{EnemyFighter, Nairan, NairanRay},
		{EnemyScout, Nautolan, NautolanBullet},
		{EnemyFighter, Nautolan, NautolanSpinningBullet},
	}
	for _, tc := range tests {
		if got := EnemyPattern(tc.kind, tc.faction, 0, 0, 0, 1)[0].Kind; got != ProjectileKind(
			tc.want,
		) {
			t.Errorf("%s %s fires %q, want %q", tc.faction, tc.kind, got, tc.want)
		}
	}
}

func TestEnemyPattern_AimWobblesALittle(t *testing.T) {
	t.Parallel()

	angles := map[float64]bool{}
	for seed := range uint32(50) {
		bullet := EnemyPattern(
			EnemyFighter, Klaed, 0, 0, 1, seed)[0]
		if math.Abs(bullet.Angle-1) > EnemyAimJitter {
			t.Errorf("seed %d: angle %v, want within %v of 1", seed, bullet.Angle, EnemyAimJitter)
		}
		angles[bullet.Angle] = true
	}
	if len(angles) <= 40 {
		t.Errorf("%d different aims from 50 seeds, want more than 40", len(angles))
	}
}

func TestEnemyPattern_BulletsLeaveInFront(t *testing.T) {
	t.Parallel()

	bullet := EnemyPattern(
		EnemyScout, Klaed, 100, 50, 0, 7)[0]
	if d := math.Hypot(bullet.X-100, bullet.Y-50); !closeTo(d, EnemyMuzzle) || bullet.X <= 100 {
		t.Errorf("bullet at (%v, %v), want %d ahead of (100, 50)", bullet.X, bullet.Y, EnemyMuzzle)
	}
}

func TestEnemyPattern_FrigateFiresAnEvenRing(t *testing.T) {
	t.Parallel()

	ring := EnemyPattern(
		EnemyFrigate, Klaed, 100, 50, 0, 9)
	if got, want := len(ring), FrigateRingBullets; got != want {
		t.Fatalf("len(ring) = %d, want %d", got, want)
	}
	step := Tau / FrigateRingBullets
	for i, bullet := range ring {
		if bullet.Kind != ProjectileKind(KlaedBigBullet) {
			t.Errorf("bullet %d is %q, want the big bullet", i, bullet.Kind)
		}
		if d := math.Hypot(bullet.X-100, bullet.Y-50); !closeTo(d, FrigateMuzzle) {
			t.Errorf("bullet %d leaves %v from the center, want %d", i, d, FrigateMuzzle)
		}
		if got := WrapAngle(bullet.Angle - ring[0].Angle - step*float64(i)); !closeTo(got, 0) {
			t.Errorf("bullet %d is %v off its place in the ring", i, got)
		}
	}
}

func TestEnemyPattern_FrigateRingTurnsWithTheSeed(t *testing.T) {
	t.Parallel()

	turns := map[float64]bool{}
	for seed := range uint32(20) {
		first := EnemyPattern(
			EnemyFrigate, Klaed, 0, 0, 1, seed)[0].Angle
		if first < 1 || first >= 1+Tau/FrigateRingBullets {
			t.Errorf("seed %d: first bullet at %v, want within one gap after 1", seed, first)
		}
		turns[first] = true
	}
	if len(turns) <= 15 {
		t.Errorf("%d different turns from 20 seeds, want more than 15", len(turns))
	}
}

func TestEnemyPattern_TheDreadnoughtTakesItsVolleysInTurn(t *testing.T) {
	t.Parallel()

	for seed := range uint32(30) {
		ring := EnemyPattern(
			EnemyDreadnought, Klaed, 0, 0, 0, DreadnoughtSeed(seed, DreadnoughtRing))
		if len(ring) != FrigateRingBullets || ring[0].Kind != ProjectileKind(KlaedBigBullet) {
			t.Fatalf(
				"seed %d: ring volley = %d of %q, want %d big bullets",
				seed,
				len(ring),
				ring[0].Kind,
				FrigateRingBullets,
			)
		}
		if d := math.Hypot(ring[0].X, ring[0].Y); !closeTo(d, DreadnoughtMuzzle) {
			t.Errorf("seed %d: ring leaves %v from the center, want %d", seed, d, DreadnoughtMuzzle)
		}

		beam := EnemyPattern(
			EnemyDreadnought,
			Klaed,
			0,
			0,
			math.Pi/2,
			DreadnoughtSeed(seed, DreadnoughtRay),
		)
		if len(beam) != DreadnoughtRaySegments {
			t.Fatalf(
				"seed %d: ray volley = %d segments, want %d",
				seed,
				len(beam),
				DreadnoughtRaySegments,
			)
		}
		for i, b := range beam {
			want := float64(DreadnoughtMuzzle + i*DreadnoughtRaySpacing)
			if b.Kind != ProjectileKind(KlaedRay) || !closeTo(b.X, 0) || !closeTo(b.Y, want) ||
				b.Angle != math.Pi/2 {
				t.Errorf(
					"seed %d: beam segment %d = %+v, want a Ray at (0, %v) heading down",
					seed,
					i,
					b,
					want,
				)
			}
		}

		waves := EnemyPattern(
			EnemyDreadnought, Klaed, 0, 0, 0, DreadnoughtSeed(seed, DreadnoughtWave))
		if len(waves) != DreadnoughtWaves || waves[0].Kind != ProjectileKind(KlaedWave) {
			t.Fatalf(
				"seed %d: wave volley = %d of %q, want %d Waves",
				seed,
				len(waves),
				waves[0].Kind,
				DreadnoughtWaves,
			)
		}
		first, last := waves[0].Angle, waves[len(waves)-1].Angle
		if !closeTo(first, -DreadnoughtWaveSpread/2) || !closeTo(last, DreadnoughtWaveSpread/2) {
			t.Errorf(
				"seed %d: waves from %v to %v, want spread across %v",
				seed,
				first,
				last,
				DreadnoughtWaveSpread,
			)
		}
	}
}

func TestEnemyPattern_TheNairanDreadnoughtFiresItsOwnShots(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		volley DreadnoughtVolley
		kind   ProjectileKind
		count  int
		spread float64
	}{
		{DreadnoughtRay, ProjectileKind(NairanRay), DreadnoughtRaySegments, 0},
		{DreadnoughtWave, ProjectileKind(NairanRocket), DreadnoughtWaves, DreadnoughtWaveSpread},
		{DreadnoughtRing, ProjectileKind(NairanTorpedo), DreadnoughtTorpedoes, DreadnoughtTorpedoFan},
	} {
		shots := EnemyPattern(EnemyDreadnought, Nairan, 0, 0, 0, DreadnoughtSeed(7, tc.volley))
		if len(shots) != tc.count || shots[0].Kind != tc.kind {
			t.Fatalf(
				"volley %d = %d of %q, want %d of %q",
				tc.volley,
				len(shots),
				shots[0].Kind,
				tc.count,
				tc.kind,
			)
		}
		first, last := shots[0].Angle, shots[len(shots)-1].Angle
		if !closeTo(first, -tc.spread/2) || !closeTo(last, tc.spread/2) {
			t.Errorf(
				"volley %d from %v to %v, want spread across %v",
				tc.volley,
				first,
				last,
				tc.spread,
			)
		}
	}
}

func TestDreadnoughtSeed_KeepsMostOfTheSeed(t *testing.T) {
	t.Parallel()

	for _, v := range []DreadnoughtVolley{DreadnoughtRing, DreadnoughtRay, DreadnoughtWave} {
		got := DreadnoughtSeed(1_000_000, v)
		d := int64(got) - 1_000_000
		if d < -2 || d > 2 || got%3 != uint32(v) { //nolint:gosec // 0 to 2.
			t.Errorf(
				"DreadnoughtSeed(1000000, %d) = %d, want within 2 of the seed, naming the volley",
				v,
				got,
			)
		}
	}
}

func TestEnemyKinds_TheDreadnoughtIsTheBiggest(t *testing.T) {
	t.Parallel()

	if !slices.Contains(EnemyKinds(), EnemyDreadnought) {
		t.Fatal("EnemyKinds() leaves out the Dreadnought")
	}
	if EnemyRadius(EnemyDreadnought, Klaed) <= EnemyRadius(EnemyFrigate, Klaed) ||
		EnemyHP(EnemyDreadnought) != DreadnoughtMaxHP(1) {
		t.Errorf(
			"Dreadnought radius %v, hp %v; want bigger than a Frigate, %v",
			EnemyRadius(EnemyDreadnought, Klaed),
			EnemyHP(EnemyDreadnought),
			DreadnoughtMaxHP(1),
		)
	}
	for _, id := range []EnemyBulletID{KlaedRay, KlaedWave} {
		if s := EnemyBulletStatsOf(id); s.Speed <= 0 || s.Lifetime <= 0 {
			t.Errorf("%s flies %+v, want a speed and a lifetime", id, s)
		}
	}
}

func TestDreadnoughtMaxHP(t *testing.T) {
	t.Parallel()

	tests := []struct {
		weight float64
		want   float64
	}{
		{0, DreadnoughtBaseHP},
		{1, DreadnoughtBaseHP + DreadnoughtHPPerPlayer},
		{4.5, DreadnoughtBaseHP + 4.5*DreadnoughtHPPerPlayer},
	}
	for _, tc := range tests {
		if got := DreadnoughtMaxHP(tc.weight); got != tc.want {
			t.Errorf("DreadnoughtMaxHP(%v) = %v, want %v", tc.weight, got, tc.want)
		}
	}
}

func TestDreadnoughtRegen(t *testing.T) {
	t.Parallel()

	tests := []struct {
		share float64
		hours float64
		want  float64
	}{
		{0.5, 0, 0.5},
		{0.5, 1, 0.5 + DreadnoughtRegenPerHour},
		{0.5, 2.5, 0.5 + 2.5*DreadnoughtRegenPerHour},
		{1 - DreadnoughtRegenPerHour/2, 1, 1},
		{0.5, -3, 0.5},
	}
	for _, tc := range tests {
		if got := DreadnoughtRegen(tc.share, tc.hours); math.Abs(got-tc.want) > 1e-12 {
			t.Errorf("DreadnoughtRegen(%v, %v) = %v, want %v", tc.share, tc.hours, got, tc.want)
		}
	}
}
