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

func TestEnemyPattern_TheNautolanDreadnoughtFiresItsOwnShots(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		volley DreadnoughtVolley
		kind   ProjectileKind
		count  int
	}{
		{DreadnoughtRay, ProjectileKind(NautolanRay), DreadnoughtRaySegments},
		{DreadnoughtWave, ProjectileKind(NautolanWave), DreadnoughtWaves},
		{DreadnoughtRing, ProjectileKind(NautolanSpinningBullet), MaxVolleyBullets},
	} {
		shots := EnemyPattern(EnemyDreadnought, Nautolan, 0, 0, 0, DreadnoughtSeed(7, tc.volley))
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
	}
	ring := EnemyPattern(EnemyDreadnought, Nautolan, 0, 0, 0, DreadnoughtSeed(7, DreadnoughtRing))
	if d := math.Hypot(ring[0].X, ring[0].Y); !closeTo(d, DreadnoughtMuzzle) {
		t.Errorf("the ring leaves %v from the center, want %d", d, DreadnoughtMuzzle)
	}
}

func TestEnemyPattern_TheNautolanDreadnoughtSpirals(t *testing.T) {
	t.Parallel()

	const angle = 0.3
	for seed := range uint32(30) {
		arms := EnemyPattern(
			EnemyDreadnought, Nautolan, 0, 0, angle, DreadnoughtSeed(seed, DreadnoughtSpiral))
		if len(arms) != DreadnoughtSpiralArms {
			t.Fatalf(
				"seed %d: spiral burst = %d bullets, want %d",
				seed,
				len(arms),
				DreadnoughtSpiralArms,
			)
		}
		for i, b := range arms {
			want := angle + Tau*float64(i)/DreadnoughtSpiralArms
			if b.Kind != ProjectileKind(NautolanSpinningBullet) || !closeTo(b.Angle, want) {
				t.Errorf(
					"seed %d: arm %d = %q at %v, want a Spinning Bullet at %v",
					seed,
					i,
					b.Kind,
					b.Angle,
					want,
				)
			}
			x, y := DreadnoughtMuzzle*math.Cos(want), DreadnoughtMuzzle*math.Sin(want)
			if !closeTo(b.X, x) || !closeTo(b.Y, y) {
				t.Errorf(
					"seed %d: arm %d leaves at (%v, %v), want (%v, %v)",
					seed,
					i,
					b.X,
					b.Y,
					x,
					y,
				)
			}
		}
	}
}

// spiralShot is one of a spiral's bullets, and the burst it left in.
type spiralShot struct {
	shot  Projectile
	burst int
}

// spiralArms are the bullets of a spiral turning way, by arm, in the order
// they leave; a skipped burst leaves none.
func spiralArms(way int) [][]spiralShot {
	arms := make([][]spiralShot, DreadnoughtSpiralArms)
	for k := range DreadnoughtSpiralBursts {
		if !DreadnoughtSpiralFires(k) {
			continue
		}
		burst := EnemyPattern(EnemyDreadnought, Nautolan, 0, 0, DreadnoughtSpiralAngle(k, way),
			DreadnoughtSeed(7, DreadnoughtSpiral))
		for a, b := range burst {
			arms[a] = append(arms[a], spiralShot{
				shot: Projectile{
					Kind: b.Kind, OriginX: b.X, OriginY: b.Y, Angle: b.Angle, Curve: b.Curve,
				},
				burst: k,
			})
		}
	}

	return arms
}

// spiralPaths is how many paths a spiral's bullets can fly, evenly spaced
// round the Dreadnought, and the angle between two of them.
func spiralPaths() (int, float64) {
	paths := DreadnoughtSpiralBursts * DreadnoughtSpiralArms

	return paths, Tau / float64(paths)
}

// spiralFlown counts the bullets of a spiral turning way along each path,
// the paths counted from straight up.
func spiralFlown(t *testing.T, way int) []int {
	t.Helper()

	paths, between := spiralPaths()
	flown := make([]int, paths)
	for _, arm := range spiralArms(way) {
		for _, b := range arm {
			fromUp := WrapAngle(b.shot.Angle - DreadnoughtSpiralStart)
			nearest := math.Round(fromUp / between)
			if !closeTo(fromUp, nearest*between) {
				t.Errorf(
					"way %v: burst %d flies along %v, off the paths",
					way,
					b.burst,
					b.shot.Angle,
				)

				continue
			}
			flown[(int(nearest)+paths)%paths]++
		}
	}

	return flown
}

// spiralHoles are the paths no bullet of a spiral turning way flies.
func spiralHoles(t *testing.T, way int) []int {
	t.Helper()

	var holes []int
	for path, n := range spiralFlown(t, way) {
		if n == 0 {
			holes = append(holes, path)
		}
	}

	return holes
}

func TestDreadnoughtSpiralAngle_FliesTheSamePathsFromStraightUp(t *testing.T) {
	t.Parallel()

	_, between := spiralPaths()
	for _, way := range []int{1, -1} {
		if got := DreadnoughtSpiralAngle(0, way); !closeTo(got, -Tau/4) {
			t.Errorf("way %v: the first burst along %v, want straight up, %v", way, got, -Tau/4)
		}
		for path, n := range spiralFlown(t, way) {
			if n > 1 {
				t.Errorf(
					"way %v: %d bullets fly the path %v from straight up, want 1 at most",
					way,
					n,
					float64(path)*between,
				)
			}
		}
	}
}

func TestDreadnoughtSpiralFires_LeavesTheSame12HolesEitherWay(t *testing.T) {
	t.Parallel()

	for k := range DreadnoughtSpiralBursts {
		if got, want := DreadnoughtSpiralFires(k), k%4 != 2; got != want {
			t.Errorf("DreadnoughtSpiralFires(%d) = %v, want %v", k, got, want)
		}
	}
	const holes = 12
	positive, negative := spiralHoles(t, 1), spiralHoles(t, -1)
	if len(positive) != holes || !slices.Equal(positive, negative) {
		t.Errorf(
			"empty paths turning the positive way %v and the negative way %v, "+
				"want the same %d both ways",
			positive,
			negative,
			holes,
		)
	}
}

func TestEnemyPattern_AStillShipInASpiralHoleIsNeverHit(t *testing.T) {
	t.Parallel()

	const (
		from = 150
		dt   = 0.004
		hit  = ShipRadius + ShotRadius
	)
	stats := ProjectileStatsOf(ProjectileKind(NautolanSpinningBullet))
	reach := DreadnoughtMuzzle + Traveled(stats, stats.Lifetime)
	_, between := spiralPaths()
	for _, way := range []int{1, -1} {
		// The ship stands still, so every place a bullet passes counts,
		// whenever it passes.
		var passes []Vec
		for _, arm := range spiralArms(way) {
			for i := range arm {
				for step := range int(stats.Lifetime/dt) + 1 {
					passes = append(passes, PositionAt(&arm[i].shot, float64(step)*dt))
				}
			}
		}
		holes := spiralHoles(t, way)
		if len(holes) == 0 {
			t.Fatalf("way %v: the spiral leaves no hole", way)
		}
		closest, where := math.Inf(1), Vec{}
		for _, path := range holes {
			angle := DreadnoughtSpiralStart + float64(path)*between
			for r := float64(from); r <= reach; r++ {
				ship := Vec{X: r * math.Cos(angle), Y: r * math.Sin(angle)}
				for _, p := range passes {
					if d := math.Hypot(p.X-ship.X, p.Y-ship.Y); d < closest {
						closest, where = d, ship
					}
				}
			}
		}
		if closest <= hit {
			t.Errorf(
				"way %v: a bullet comes %.2f px from a still ship at (%.0f, %.0f) in a hole, "+
					"want more than %d from %d px out",
				way,
				closest,
				where.X,
				where.Y,
				hit,
				from,
			)
		}
	}
}

func TestEnemyPattern_AShipFitsThroughTheSpiral(t *testing.T) {
	t.Parallel()

	// The Nautolan Dreadnought's 72x104 base frame, at any heading, lies
	// within half its diagonal of the center.
	hull := math.Hypot(72, 104) / 2
	const gap = 2 * (ShipRadius + ShotRadius)
	const dt = 0.001
	lifetime := ProjectileStatsOf(ProjectileKind(NautolanSpinningBullet)).Lifetime
	arms := spiralArms(1)
	at := func(b *spiralShot, now float64) (Vec, bool) {
		age := now - float64(b.burst)*DreadnoughtSpiralEvery
		if age < 0 || age > lifetime {
			return Vec{}, false
		}
		v := PositionAt(&b.shot, age)

		return v, math.Hypot(v.X, v.Y) > hull
	}
	closest := math.Inf(1)
	end := float64(DreadnoughtSpiralBursts)*DreadnoughtSpiralEvery + lifetime
	for step := range int(end / dt) {
		now := float64(step) * dt
		for _, arm := range arms {
			for k := 1; k < len(arm); k++ {
				p, out := at(&arm[k-1], now)
				q, outToo := at(&arm[k], now)
				if out && outToo {
					closest = math.Min(closest, math.Hypot(p.X-q.X, p.Y-q.Y))
				}
			}
		}
	}
	if closest <= gap {
		t.Errorf(
			"neighbors on a spiral arm come %.2f px apart outside the %.1f px hull, "+
				"want more than %d for a ship to fit between",
			closest,
			hull,
			gap,
		)
	}
}

func TestDreadnoughtTurn(t *testing.T) {
	t.Parallel()

	three := []DreadnoughtVolley{DreadnoughtRing, DreadnoughtRay, DreadnoughtWave}
	for _, tc := range []struct {
		faction EnemyFaction
		want    []DreadnoughtVolley
	}{
		{Klaed, three},
		{Nairan, three},
		{Nautolan, []DreadnoughtVolley{DreadnoughtRing, DreadnoughtRay, DreadnoughtSpiral, DreadnoughtWave}},
	} {
		if got := DreadnoughtTurn(tc.faction); !slices.Equal(got, tc.want) {
			t.Errorf("DreadnoughtTurn(%s) = %v, want %v", tc.faction, got, tc.want)
		}
	}
}

func TestDreadnoughtSeed_KeepsMostOfTheSeed(t *testing.T) {
	t.Parallel()

	for _, v := range []DreadnoughtVolley{
		DreadnoughtRing, DreadnoughtRay, DreadnoughtWave, DreadnoughtSpiral,
	} {
		got := DreadnoughtSeed(1_000_000, v)
		d := int64(got) - 1_000_000
		if d < -3 || d > 3 || DreadnoughtVolleyOf(got) != v {
			t.Errorf(
				"DreadnoughtSeed(1000000, %d) = %d, want within 3 of the seed, naming the volley",
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
