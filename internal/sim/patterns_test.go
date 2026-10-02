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

	a := EnemyPattern(EnemyScout, 10, 20, 1, 42)
	b := EnemyPattern(EnemyScout, 10, 20, 1, 42)
	if !reflect.DeepEqual(a, b) {
		t.Errorf("same seed: %+v != %+v", a, b)
	}
}

func TestEnemyPattern_EachEnemyItsOwnBullet(t *testing.T) {
	t.Parallel()

	tests := []struct {
		kind EnemyKind
		want ProjectileKind
	}{
		{EnemyScout, ProjectileKind(KlaedBullet)},
		{EnemyFighter, ProjectileKind(KlaedBigBullet)},
	}
	for _, tc := range tests {
		if got := EnemyPattern(tc.kind, 0, 0, 0, 1)[0].Kind; got != tc.want {
			t.Errorf("%s fires %q, want %q", tc.kind, got, tc.want)
		}
	}
}

func TestEnemyPattern_AimWobblesALittle(t *testing.T) {
	t.Parallel()

	angles := map[float64]bool{}
	for seed := range uint32(50) {
		bullet := EnemyPattern(EnemyFighter, 0, 0, 1, seed)[0]
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

	bullet := EnemyPattern(EnemyScout, 100, 50, 0, 7)[0]
	if d := math.Hypot(bullet.X-100, bullet.Y-50); !closeTo(d, EnemyMuzzle) || bullet.X <= 100 {
		t.Errorf("bullet at (%v, %v), want %d ahead of (100, 50)", bullet.X, bullet.Y, EnemyMuzzle)
	}
}

func TestEnemyPattern_FrigateFiresAnEvenRing(t *testing.T) {
	t.Parallel()

	ring := EnemyPattern(EnemyFrigate, 100, 50, 0, 9)
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
		first := EnemyPattern(EnemyFrigate, 0, 0, 1, seed)[0].Angle
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
		ring := EnemyPattern(EnemyDreadnought, 0, 0, 0, DreadnoughtSeed(seed, DreadnoughtRing))
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

		waves := EnemyPattern(EnemyDreadnought, 0, 0, 0, DreadnoughtSeed(seed, DreadnoughtWave))
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
	if EnemyRadius(EnemyDreadnought) <= EnemyRadius(EnemyFrigate) ||
		EnemyHP(EnemyDreadnought) != DreadnoughtHP {
		t.Errorf(
			"Dreadnought radius %v, hp %v; want bigger than a Frigate, %d",
			EnemyRadius(EnemyDreadnought),
			EnemyHP(EnemyDreadnought),
			DreadnoughtHP,
		)
	}
	for _, id := range []EnemyBulletID{KlaedRay, KlaedWave} {
		if s := EnemyBulletStatsOf(id); s.Speed <= 0 || s.Lifetime <= 0 {
			t.Errorf("%s flies %+v, want a speed and a lifetime", id, s)
		}
	}
}

func TestDreadnoughtRegen(t *testing.T) {
	t.Parallel()

	tests := []struct {
		hp    int
		hours float64
		want  int
	}{
		{100_000, 0, 100_000},
		{100_000, 1, 100_000 + DreadnoughtRegenPerHour},
		{100_000, 2.5, 100_000 + 5*DreadnoughtRegenPerHour/2},
		{DreadnoughtHP - 10, 1, DreadnoughtHP},
		{100_000, -3, 100_000},
	}
	for _, tc := range tests {
		if got := DreadnoughtRegen(tc.hp, tc.hours); got != tc.want {
			t.Errorf("DreadnoughtRegen(%d, %v) = %d, want %d", tc.hp, tc.hours, got, tc.want)
		}
	}
}
