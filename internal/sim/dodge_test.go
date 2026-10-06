package sim_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

// holding are orders that keep a companion where it is, at (x, y), and never
// fire.
func holding(x, y float64) Orders {
	o := DefaultOrders()
	o.Stance, o.HoldX, o.HoldY, o.Fire = StanceHold, x, y, FireHold

	return o
}

// bulletAt is a Kla'ed Bullet at (x, y) flying along angle, age seconds old.
func bulletAt(x, y, angle, age float64) *Projectile {
	pool := NewPool(1)
	p := pool.Spawn(
		ProjectileSpawn{Kind: ProjectileKind(KlaedBullet), X: x, Y: y, Angle: angle},
		SpawnOptions{Faction: FactionEnemy},
	)
	p.OriginX -= math.Cos(angle) * Traveled(ProjectileStatsOf(p.Kind), age)
	p.OriginY -= math.Sin(angle) * Traveled(ProjectileStatsOf(p.Kind), age)
	p.Age = age
	Place(p)

	return p
}

// seeing is what a companion sees of p: p.
func seeing(p *Projectile) []Bullet { return []Bullet{BulletOf(p)} }

// blind is what a companion sees of p: nothing.
func blind(*Projectile) []Bullet { return nil }

// closestPass flies a holding companion at the origin against p for two
// seconds, the companion seeing what sees shows it, and returns how close,
// center to center, p came.
func closestPass(p *Projectile, sees func(*Projectile) []Bullet) float64 {
	self := newShip(0, 0)
	random := NewRandom(1)
	closest := math.Hypot(p.X-self.X, p.Y-self.Y)
	for range 2 * TickRate {
		view := BrainView{Self: self, Owner: Mover{X: 0, Y: 300}, Bullets: sees(p)}
		StepShip(self, Think(view, holding(0, 0), random).Command, TickSeconds)
		p.Age += TickSeconds
		Place(p)
		closest = math.Min(closest, math.Hypot(p.X-self.X, p.Y-self.Y))
	}

	return closest
}

func TestDodge_ABulletOnACollisionCourseIsAvoided(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name  string
		angle float64
	}{
		{"from the left", 0},
		{"from above", math.Pi / 2},
		{"from behind at an angle", -2.5},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			from := Vec{X: -150 * math.Cos(tc.angle), Y: -150 * math.Sin(tc.angle)}
			hit := float64(ShipRadius + ShotRadius)
			if got := closestPass(bulletAt(from.X, from.Y, tc.angle, 0.5), blind); got > hit {
				t.Fatalf("unseen, it passed %.1f px away, want a hit to dodge", got)
			}
			if got := closestPass(bulletAt(from.X, from.Y, tc.angle, 0.5), seeing); got <= hit {
				t.Errorf("seen, it passed %.1f px away, want more than %v", got, hit)
			}
		})
	}
}

// command is what a holding companion at the origin decides seeing bullets.
func command(bullets ...Bullet) Command {
	view := BrainView{Self: newShip(0, 0), Owner: Mover{X: 0, Y: 300}, Bullets: bullets}

	return Think(view, holding(0, 0), NewRandom(1)).Command
}

func TestDodge_BulletsItNeedNotDodgeChangeNothing(t *testing.T) {
	t.Parallel()

	young := BrainDodgeReaction / 2
	far := float64(BrainDodgeRadius + 10)
	for _, tc := range []struct {
		name   string
		bullet Bullet
	}{
		{"one passing wide", BulletOf(bulletAt(-150, 60, 0, 0.5))},
		{"one flying away", BulletOf(bulletAt(-50, 0, math.Pi, 0.5))},
		{"one too young to have been noticed", BulletOf(bulletAt(-60, 0, 0, young))},
		{"one past the look-ahead", BulletOf(bulletAt(-130*BrainDodgeLookAhead-60, 0, 0, 0.5))},
		// Fast enough to arrive within the look-ahead, were it seen.
		{"one too far away to be seen", Bullet{X: -far, VX: 2 * far / BrainDodgeLookAhead, Age: 1}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			if got, want := command(tc.bullet), command(); got != want {
				t.Errorf("command = %+v, want %+v as with no bullets", got, want)
			}
		})
	}
}

func TestDodge_KeepsAimingAndFiring(t *testing.T) {
	t.Parallel()

	self := newShip(0, 0)
	self.Angle = -math.Pi / 2
	o := DefaultOrders()
	o.Stance, o.HoldX, o.HoldY = StanceHold, 0, 0
	enemies := []BrainEnemy{{ID: 1, Kind: EnemyScout, X: 0, Y: -150}}
	decide := func(bullets ...Bullet) Command {
		view := BrainView{Self: self, Owner: Mover{Y: 300}, Enemies: enemies, Bullets: bullets}

		return Think(view, o, NewRandom(1)).Command
	}

	calm, dodging := decide(), decide(BulletOf(bulletAt(-60, 0, 0, 0.5)))
	if dodging.MoveX == calm.MoveX && dodging.MoveY == calm.MoveY {
		t.Errorf("move = (%v, %v) with a bullet coming, want a dodge", dodging.MoveX, dodging.MoveY)
	}
	if dodging.AimX != calm.AimX || dodging.AimY != calm.AimY || dodging.Fire != calm.Fire ||
		!calm.Fire {
		t.Errorf("dodging aims and fires %+v, want %+v, firing", dodging, calm)
	}
}

func TestBulletOf(t *testing.T) {
	t.Parallel()

	p := bulletAt(10, 20, math.Pi/2, 1)
	b := BulletOf(p)
	speed := EnemyBulletStatsOf(KlaedBullet).Speed
	if b.X != 10 || b.Y != 20 || b.Age != 1 {
		t.Errorf("BulletOf at (%v, %v) aged %v, want (10, 20) aged 1", b.X, b.Y, b.Age)
	}
	if math.Abs(b.VX) > 1e-9 || math.Abs(b.VY-speed) > 1e-9 {
		t.Errorf("BulletOf velocity = (%v, %v), want (0, %v)", b.VX, b.VY, speed)
	}
}

// battle is wings of stealthy companions, each beside its parked owner, and
// an enemy above each wing firing seeded volleys at it, stepped a sim tick
// at a time as the hub steps them.
type battle struct {
	wings   []*Wing
	owners  []Mover
	enemies []Vec
	pool    *Pool
	sees    bool
	tick    int
	hits    int
	bullets []Bullet
}

// battleVolleyTicks is how often each enemy fires.
const battleVolleyTicks = 20

// newBattle is wings of three, 300 px apart in a row, each with an enemy
// 300 px above it; the companions see the bullets when sees is set.
func newBattle(wings int, sees bool) *battle {
	b := &battle{pool: NewPool(512), sees: sees}
	for i := range wings {
		x := float64(i) * 300
		var w Wing
		for n := 1; n <= 3; n++ {
			w.Add(n, x, 100, ModeOrders(ModeStealth, DefaultOrders(), 0, 0))
		}
		b.wings = append(b.wings, &w)
		b.owners = append(b.owners, Mover{X: x, Angle: -math.Pi / 2})
		b.enemies = append(b.enemies, Vec{X: x, Y: -300})
	}

	return b
}

// step fires the volleys due, flies every wing, then the bullets, and counts
// the bullets that meet a companion.
func (b *battle) step() {
	if b.tick%battleVolleyTicks == 0 {
		for i, e := range b.enemies {
			wing := b.wings[i]
			target := wing.Companions[b.tick/battleVolleyTicks%len(wing.Companions)].Ship
			angle := math.Atan2(target.Y-e.Y, target.X-e.X)
			seed := uint32(b.tick + i) //nolint:gosec // small.
			for _, s := range EnemyPattern(EnemyFighter, Klaed, e.X, e.Y, angle, seed) {
				b.pool.Spawn(s, SpawnOptions{Faction: FactionEnemy})
			}
		}
	}
	b.bullets = b.bullets[:0]
	if b.sees {
		items := b.pool.Items()
		for i := range items {
			if items[i].Active {
				b.bullets = append(b.bullets, BulletOf(&items[i]))
			}
		}
	}
	for i, w := range b.wings {
		w.Observe(b.owners[i])
		w.Bullets = b.bullets
		w.Step(nil, nil)
	}
	b.pool.Step(TickSeconds, ProjectileInBounds)
	targets := make([]ShipTarget, 0, len(b.wings)*3)
	for _, w := range b.wings {
		for _, c := range w.Companions {
			targets = append(targets, TargetOf(c.Ship))
		}
	}
	items := b.pool.Items()
	for i := range items {
		p := &items[i]
		if !p.Active {
			continue
		}
		from := PositionAt(p, math.Max(0, p.Age-TickSeconds))
		if _, _, ok := FirstShipHit(targets, from.X, from.Y, p.X, p.Y); ok {
			p.Active = false
			b.hits++
		}
	}
	b.tick++
}

func TestWing_DodgingTakesFewerHits(t *testing.T) {
	t.Parallel()

	hits := func(sees bool) int {
		b := newBattle(2, sees)
		for range 30 * TickRate {
			b.step()
		}

		return b.hits
	}
	unseen, seen := hits(false), hits(true)
	if unseen == 0 || seen*2 > unseen {
		t.Errorf("hits = %d seeing the bullets and %d not, want under half", seen, unseen)
	}
}
