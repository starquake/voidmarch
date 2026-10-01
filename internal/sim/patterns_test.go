package sim_test

import (
	"math"
	"reflect"
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
