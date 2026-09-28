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

func TestTravelled(t *testing.T) {
	t.Parallel()

	cannon := WeaponStatsOf(WeaponAutoCannon).ProjectileStats
	if got, want := Travelled(cannon, 0.5), cannon.Speed*0.5; got != want {
		t.Errorf("auto cannon: Travelled(0.5) = %v, want %v (linear)", got, want)
	}

	rockets := WeaponStatsOf(WeaponRockets).ProjectileStats
	early := Travelled(rockets, 0.1) - Travelled(rockets, 0)
	late := Travelled(rockets, 1.1) - Travelled(rockets, 1)
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
