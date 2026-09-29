package sim

import "strconv"

// ProjectileKind is what a projectile is: a player weapon's shot (a WeaponID)
// or an enemy's bullet (an EnemyBulletID).
type ProjectileKind string

// Faction says whose a projectile is.
type Faction string

// The factions: this player's, another player's, or an enemy's.
const (
	FactionOwn    Faction = "own"
	FactionRemote Faction = "remote"
	FactionEnemy  Faction = "enemy"
)

// IsWeapon reports whether kind is a player weapon's shot.
func IsWeapon(kind ProjectileKind) bool {
	switch WeaponID(kind) {
	case WeaponAutoCannon, WeaponRockets, WeaponBigSpaceGun, WeaponZapper:
		return true
	default:
		return false
	}
}

// ProjectileStatsOf is how a projectile of kind flies.
func ProjectileStatsOf(kind ProjectileKind) ProjectileStats {
	if IsWeapon(kind) {
		return WeaponStatsOf(WeaponID(kind)).ProjectileStats
	}

	return EnemyBulletStatsOf(EnemyBulletID(kind))
}

// ProjectileSpawn is where a projectile starts, which way, and what it is.
type ProjectileSpawn struct {
	Kind  ProjectileKind
	X     float64
	Y     float64
	Angle float64
}

// SpawnOptions describe a projectile that isn't a fresh shot of this
// player's.
type SpawnOptions struct {
	// AgeSeconds: already this old, a shot seen late on the delayed timeline.
	AgeSeconds float64
	// Faction is FactionOwn when empty.
	Faction Faction
	// Owner is the remote player or enemy it belongs to, or the companion
	// number of an own shot; empty for the player's own.
	Owner string
	// ShotID is the shot's id for its owner; 0 gives own shots the next one.
	ShotID int
}

// Projectile is one shot or bullet in flight.
type Projectile struct {
	Active  bool
	Kind    ProjectileKind
	Faction Faction
	Owner   string
	ShotID  int
	OriginX float64
	OriginY float64
	Angle   float64
	Age     float64
	X       float64
	Y       float64
}

// Traveled is the distance covered after age seconds, accelerating up to
// MaxSpeed.
func Traveled(stats ProjectileStats, age float64) float64 {
	if stats.Acceleration <= 0 {
		return stats.Speed * age
	}
	rampTime := max(0, (stats.MaxSpeed-stats.Speed)/stats.Acceleration)
	if age <= rampTime {
		return stats.Speed*age + half*stats.Acceleration*age*age
	}
	ramp := stats.Speed*rampTime + half*stats.Acceleration*rampTime*rampTime

	return ramp + stats.MaxSpeed*(age-rampTime)
}

// PositionAt is where p is at the given age. Position is a pure function of
// the spawn and the age, so every client simulates the same projectile from
// the same spawn.
func PositionAt(p *Projectile, age float64) Vec {
	stats := ProjectileStatsOf(p.Kind)
	lateral := stats.Zigzag.Amplitude * TriangleWave(age*stats.Zigzag.Frequency)
	offset := RotateOffset(Traveled(stats, age), lateral, p.Angle)

	return Vec{X: p.OriginX + offset.X, Y: p.OriginY + offset.Y}
}

// Place puts p where its age says.
func Place(p *Projectile) {
	at := PositionAt(p, p.Age)
	p.X, p.Y = at.X, at.Y
}

// Pool is a fixed-size set of projectiles, so firing never allocates. When
// full, the oldest is reused.
type Pool struct {
	items      []Projectile
	next       int
	lastShotID int
}

// NewPool returns an empty pool of capacity projectiles.
func NewPool(capacity int) *Pool {
	items := make([]Projectile, capacity)
	for i := range items {
		items[i] = Projectile{Kind: ProjectileKind(WeaponAutoCannon), Faction: FactionOwn}
	}

	return &Pool{items: items}
}

// Items is every projectile slot, active or not.
func (p *Pool) Items() []Projectile {
	return p.items
}

// ActiveCount is how many projectiles are in flight.
func (p *Pool) ActiveCount() int {
	n := 0
	for i := range p.items {
		if p.items[i].Active {
			n++
		}
	}

	return n
}

// Spawn starts a projectile and returns it.
func (p *Pool) Spawn(shot ProjectileSpawn, opts SpawnOptions) *Projectile {
	var chosen *Projectile
	for i := 0; i < len(p.items) && chosen == nil; i++ {
		candidate := &p.items[(p.next+i)%len(p.items)]
		if !candidate.Active {
			chosen = candidate
			p.next = (p.next + i + 1) % len(p.items)
		}
	}
	if chosen == nil {
		chosen = p.oldest()
	}

	chosen.Active = true
	chosen.Kind = shot.Kind
	chosen.Faction = opts.Faction
	if chosen.Faction == "" {
		chosen.Faction = FactionOwn
	}
	chosen.Owner = opts.Owner
	chosen.ShotID = opts.ShotID
	if chosen.ShotID == 0 {
		p.lastShotID++
		chosen.ShotID = p.lastShotID
	}
	chosen.OriginX, chosen.OriginY = shot.X, shot.Y
	chosen.Angle = shot.Angle
	chosen.Age = opts.AgeSeconds
	Place(chosen)

	return chosen
}

// Clear ends every projectile of a faction: the server's are gone once
// offline.
func (p *Pool) Clear(faction Faction) {
	for i := range p.items {
		if p.items[i].Faction == faction {
			p.items[i].Active = false
		}
	}
}

// End ends a remote player's shot that hit something, and returns it.
func (p *Pool) End(owner string, shotID int) *Projectile {
	for i := range p.items {
		q := &p.items[i]
		if q.Active && q.Faction == FactionRemote && q.Owner == owner && q.ShotID == shotID {
			q.Active = false

			return q
		}
	}

	return nil
}

// EndCompanionShots ends the own shots of companion number, which could no
// longer be reported once it's gone.
func (p *Pool) EndCompanionShots(number int) {
	owner := strconv.Itoa(number)
	for i := range p.items {
		if q := &p.items[i]; q.Faction == FactionOwn && q.Owner == owner {
			q.Active = false
		}
	}
}

// Step ages every projectile by dt and returns those that expired this tick.
func (p *Pool) Step(dt float64, inBounds func(x, y float64) bool) []*Projectile {
	var expired []*Projectile
	for i := range p.items {
		q := &p.items[i]
		if !q.Active {
			continue
		}
		q.Age += dt
		Place(q)
		if q.Age >= ProjectileStatsOf(q.Kind).Lifetime || !inBounds(q.X, q.Y) {
			q.Active = false
			expired = append(expired, q)
		}
	}

	return expired
}

func (p *Pool) oldest() *Projectile {
	oldest := &p.items[0]
	for i := range p.items {
		if p.items[i].Age > oldest.Age {
			oldest = &p.items[i]
		}
	}

	return oldest
}
