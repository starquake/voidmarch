package sim_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

func always(float64, float64) bool { return true }

func spawnAt(pool *Pool, kind ProjectileKind) *Projectile {
	return pool.Spawn(ProjectileSpawn{Kind: kind}, SpawnOptions{})
}

func TestTraveled(t *testing.T) {
	t.Parallel()

	cannon := WeaponStatsOf(WeaponAutoCannon).ProjectileStats
	if got, want := Traveled(cannon, 0.5), cannon.Speed*0.5; got != want {
		t.Errorf("auto cannon: Traveled(0.5) = %v, want %v (linear)", got, want)
	}

	rockets := WeaponStatsOf(WeaponRockets).ProjectileStats
	early := Traveled(rockets, 0.1) - Traveled(rockets, 0)
	late := Traveled(rockets, 1.1) - Traveled(rockets, 1)
	if early >= late || math.Abs(late-rockets.MaxSpeed*0.1) > 1e-6 {
		t.Errorf(
			"rockets: early %v, late %v, want accelerating up to %v px/s",
			early,
			late,
			rockets.MaxSpeed,
		)
	}
}

func TestPlace_IsPureAndZigzags(t *testing.T) {
	t.Parallel()

	a := Projectile{
		Kind:    ProjectileKind(WeaponZapper),
		OriginX: 10,
		OriginY: 20,
		Angle:   1,
		Age:     0.3,
	}
	b := a
	Place(&a)
	Place(&b)
	if a != b {
		t.Errorf("Place() = %+v and %+v, want the same", a, b)
	}

	p := Projectile{Kind: ProjectileKind(WeaponZapper)}
	sides := map[float64]bool{}
	for age := 0.01; age < 0.4; age += 0.02 {
		p.Age = age
		Place(&p)
		sides[math.Copysign(1, math.Round(p.Y*1000))] = true
	}
	if !sides[1] || !sides[-1] {
		t.Errorf("zapper sides = %v, want both", sides)
	}
}

func TestPool_FlyAndExpire(t *testing.T) {
	t.Parallel()

	pool := NewPool(8)
	p := spawnAt(pool, ProjectileKind(WeaponAutoCannon))
	if got := pool.ActiveCount(); got != 1 {
		t.Fatalf("ActiveCount() = %d, want 1", got)
	}
	pool.Step(TickSeconds, always)
	if p.X <= 0 {
		t.Errorf("after a tick x = %v, want moving along +x", p.X)
	}
	expired := 0
	for tick := 0.0; tick < WeaponStatsOf(WeaponAutoCannon).Lifetime+0.1; tick += TickSeconds {
		expired += len(pool.Step(TickSeconds, always))
	}
	if expired != 1 || pool.ActiveCount() != 0 {
		t.Errorf("expired %d, active %d, want 1 and 0", expired, pool.ActiveCount())
	}

	spawnAt(pool, ProjectileKind(WeaponAutoCannon))
	if got := len(pool.Step(TickSeconds, func(float64, float64) bool { return false })); got != 1 {
		t.Errorf("out of bounds: expired %d, want 1", got)
	}
}

func TestPool_ReusesTheOldest(t *testing.T) {
	t.Parallel()

	pool := NewPool(2)
	first := spawnAt(pool, ProjectileKind(WeaponAutoCannon))
	pool.Step(TickSeconds, always)
	spawnAt(pool, ProjectileKind(WeaponAutoCannon))
	third := pool.Spawn(
		ProjectileSpawn{Kind: ProjectileKind(WeaponRockets), X: 5, Y: 5},
		SpawnOptions{},
	)
	if third != first || third.Kind != ProjectileKind(WeaponRockets) || pool.ActiveCount() != 2 {
		t.Errorf("full pool: third = %+v, want the first slot reused as rockets", third)
	}
}

func TestPool_StartsPartWay(t *testing.T) {
	t.Parallel()

	pool := NewPool(2)
	p := pool.Spawn(
		ProjectileSpawn{Kind: ProjectileKind(WeaponAutoCannon)},
		SpawnOptions{AgeSeconds: 0.5},
	)
	if want := WeaponStatsOf(WeaponAutoCannon).Speed * 0.5; p.Age != 0.5 || p.X != want {
		t.Errorf("spawned at age %v, x %v, want 0.5 and %v", p.Age, p.X, want)
	}
	pool = NewPool(1)
	p = pool.Spawn(
		ProjectileSpawn{Kind: ProjectileKind(WeaponAutoCannon), X: 5, Y: 7, Angle: 0.5},
		SpawnOptions{AgeSeconds: 0.4},
	)
	if at := PositionAt(p, p.Age); at.X != p.X || at.Y != p.Y {
		t.Errorf("PositionAt(age) = %v, want (%v, %v)", at, p.X, p.Y)
	}
	if at := PositionAt(p, 0); at != (Vec{X: 5, Y: 7}) {
		t.Errorf("PositionAt(0) = %v, want the spawn point", at)
	}
}

func TestPool_ShotIDs(t *testing.T) {
	t.Parallel()

	pool := NewPool(4)
	a := spawnAt(pool, ProjectileKind(WeaponAutoCannon))
	b := spawnAt(pool, ProjectileKind(WeaponAutoCannon))
	if a.Faction != FactionOwn || b.ShotID != a.ShotID+1 {
		t.Errorf("own shots %+v then %+v, want own and increasing ids", a, b)
	}
	remote := pool.Spawn(
		ProjectileSpawn{Kind: ProjectileKind(WeaponZapper)},
		SpawnOptions{Faction: FactionRemote, Owner: "mo", ShotID: 77},
	)
	if remote.Faction != FactionRemote || remote.Owner != "mo" || remote.ShotID != 77 {
		t.Errorf("remote shot = %+v, want mo's 77", remote)
	}
}

func TestPool_ClearAndEnd(t *testing.T) {
	t.Parallel()

	pool := NewPool(4)
	pool.Spawn(
		ProjectileSpawn{Kind: ProjectileKind(KlaedBullet)},
		SpawnOptions{Faction: FactionEnemy, Owner: "3"},
	)
	pool.Spawn(
		ProjectileSpawn{Kind: ProjectileKind(WeaponZapper)},
		SpawnOptions{Faction: FactionRemote, Owner: "mo", ShotID: 7},
	)
	own := spawnAt(pool, ProjectileKind(WeaponZapper))

	if pool.End("sanne", 7) != nil {
		t.Error("End(sanne, 7) ended a shot, want none")
	}
	if p := pool.End("mo", 7); p == nil || p.ShotID != 7 {
		t.Errorf("End(mo, 7) = %+v, want mo's shot 7", p)
	}
	if pool.End("", own.ShotID) != nil {
		t.Error("End() ended an own shot, want only remote ones")
	}
	pool.Clear(FactionEnemy)
	var active []Faction
	for _, p := range pool.Items() {
		if p.Active {
			active = append(active, p.Faction)
		}
	}
	if len(active) != 1 || active[0] != FactionOwn {
		t.Errorf("active after clearing = %v, want only the own shot", active)
	}
}

func TestPool_EnemyBullets(t *testing.T) {
	t.Parallel()

	pool := NewPool(2)
	p := pool.Spawn(
		ProjectileSpawn{Kind: ProjectileKind(KlaedBullet)},
		SpawnOptions{Faction: FactionEnemy},
	)
	pool.Step(1, always)
	if want := EnemyBulletStatsOf(KlaedBullet).Speed; p.X != want || IsWeapon(p.Kind) {
		t.Errorf("after 1 s x = %v, want %v, and not a weapon", p.X, want)
	}
	got := ProjectileStatsOf(ProjectileKind(KlaedBigBullet))
	if want := EnemyBulletStatsOf(KlaedBigBullet); got != want {
		t.Errorf("ProjectileStatsOf(big bullet) = %+v, want %+v", got, want)
	}
}

// rocketAt is a rocket in flight at the origin heading +x.
func rocketAt(pool *Pool) *Projectile {
	return pool.Spawn(
		ProjectileSpawn{Kind: ProjectileKind(WeaponRockets)},
		SpawnOptions{AgeSeconds: 0.5},
	)
}

func TestSteer_TurnsTowardTheNearestEnemyAhead(t *testing.T) {
	t.Parallel()

	seek := WeaponStatsOf(WeaponRockets).Seek
	for _, tc := range []struct {
		name   string
		target Vec
		turned bool
	}{
		{name: "ahead and to the left", target: Vec{X: 200, Y: -100}, turned: true},
		{name: "outside the cone", target: Vec{X: -100, Y: 50}},
		{name: "out of range", target: Vec{X: seek.Range + 300, Y: 50}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			pool := NewPool(4)
			r := rocketAt(pool)
			start := Vec{X: r.X, Y: r.Y}
			pool.Steer(
				TickSeconds,
				FactionOwn,
				[]Vec{{X: start.X + tc.target.X, Y: start.Y + tc.target.Y}},
			)
			if turned := r.Angle != 0; turned != tc.turned {
				t.Errorf("angle %v, turned %v, want %v", r.Angle, turned, tc.turned)
			}
			if tc.turned && math.Abs(r.Angle) > seek.TurnRate*TickSeconds+1e-9 {
				t.Errorf("turned %v in a tick, want at most %v", r.Angle, seek.TurnRate*TickSeconds)
			}
			if r.X != start.X || r.Y != start.Y {
				t.Errorf("steering moved it from %v to (%v, %v)", start, r.X, r.Y)
			}
		})
	}
}

func TestSteer_ARocketHomesIn(t *testing.T) {
	t.Parallel()

	pool := NewPool(4)
	r := rocketAt(pool)
	target := Vec{X: r.X + 250, Y: r.Y + 120}
	closest := math.Inf(1)
	for range 60 {
		pool.Steer(TickSeconds, FactionOwn, []Vec{target})
		pool.Step(TickSeconds, func(float64, float64) bool { return true })
		closest = math.Min(closest, math.Hypot(r.X-target.X, r.Y-target.Y))
	}
	if closest > 15 {
		t.Errorf("came within %v of a still target, want a hit (within 15)", closest)
	}
}

func TestSteer_OnlySeekersOfTheFaction(t *testing.T) {
	t.Parallel()

	pool := NewPool(4)
	cannon := pool.Spawn(ProjectileSpawn{Kind: ProjectileKind(WeaponAutoCannon)}, SpawnOptions{})
	remote := pool.Spawn(
		ProjectileSpawn{Kind: ProjectileKind(WeaponRockets)},
		SpawnOptions{Faction: FactionRemote},
	)
	pool.Steer(TickSeconds, FactionOwn, []Vec{{X: 100, Y: -50}})
	if cannon.Angle != 0 || remote.Angle != 0 {
		t.Errorf(
			"angles %v, %v, want an auto cannon shot and another faction's rocket left straight",
			cannon.Angle,
			remote.Angle,
		)
	}
}

func TestBigSpaceGun_BurstsAfterAShortFlight(t *testing.T) {
	t.Parallel()

	stats := ProjectileStatsOf(ProjectileKind(WeaponBigSpaceGun))
	if got, want := Traveled(stats, stats.Lifetime), 150.0; math.Abs(got-want) > 1e-9 {
		t.Errorf("a ball flies %v px before it bursts, want %v", got, want)
	}
}

func TestBurstPattern(t *testing.T) {
	t.Parallel()

	seed := BurstSeed("sanne", 7)
	a := BurstPattern(WeaponBigSpaceGun, 10, 20, seed)
	b := BurstPattern(WeaponBigSpaceGun, 10, 20, seed)
	burst := WeaponStatsOf(WeaponBigSpaceGun).Burst
	if len(a) != burst.Shards {
		t.Fatalf("%d shards, want %d", len(a), burst.Shards)
	}
	step := Tau / float64(burst.Shards)
	for k := range a {
		if a[k] != b[k] {
			t.Errorf("shard %d differs for one seed: %+v, %+v", k, a[k], b[k])
		}
		if a[k].Kind != ProjectileShard || a[k].X != 10 || a[k].Y != 20 {
			t.Errorf("shard %d = %+v, want a shard from (10, 20)", k, a[k])
		}
		if k > 0 && math.Abs(a[k].Angle-a[k-1].Angle-step) > 1e-9 {
			t.Errorf(
				"shards %d and %d are %v apart, want %v",
				k-1,
				k,
				a[k].Angle-a[k-1].Angle,
				step,
			)
		}
	}
	other := BurstPattern(WeaponBigSpaceGun, 10, 20, BurstSeed("sanne", 8))
	if other[0].Angle == a[0].Angle {
		t.Error("another shot's star is turned the same")
	}
	if got := BurstPattern(WeaponZapper, 0, 0, seed); got != nil {
		t.Errorf("a zapper bursts into %v, want nothing", got)
	}
}

func TestProjectile_Hit(t *testing.T) {
	t.Parallel()

	pool := NewPool(4)
	zap := pool.Spawn(ProjectileSpawn{Kind: ProjectileKind(WeaponZapper)}, SpawnOptions{})
	pierce := WeaponStatsOf(WeaponZapper).Pierce
	for i := range pierce {
		if !zap.Hit(i + 1) {
			t.Fatalf("hit %d ended the zapper shot, want it to carry on", i+1)
		}
	}
	if !zap.HasHit(1) || zap.HasHit(99) {
		t.Error("HasHit doesn't remember the enemies it hit")
	}
	if zap.Hit(pierce+1) || zap.Active {
		t.Errorf("hit %d carried on, want the last one to end it", pierce+1)
	}

	cannon := pool.Spawn(ProjectileSpawn{Kind: ProjectileKind(WeaponAutoCannon)}, SpawnOptions{})
	if cannon.Hit(1) || cannon.Active {
		t.Error("an auto cannon shot carried on through an enemy")
	}
}

func TestShotDamage(t *testing.T) {
	t.Parallel()

	want := WeaponStatsOf(WeaponBigSpaceGun).Burst.Damage
	if got := ShotDamage(ProjectileShard); got != want {
		t.Errorf("shard damage = %v, want %v", got, want)
	}
	if got, want := ShotDamage(ProjectileKind(WeaponRockets)), 3.0; got != want {
		t.Errorf("rocket damage = %v, want %v", got, want)
	}
}
