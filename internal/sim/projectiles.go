package sim

import (
	"hash/fnv"
	"math"
	"slices"
	"strconv"
)

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

// ProjectileShard is a shard of a big space gun ball's burst (#72).
const ProjectileShard ProjectileKind = "shard"

// maxHits is the most enemies one shot can hit: a first hit and its pierces.
const maxHits = 3

// ProjectileStatsOf is how a projectile of kind flies.
func ProjectileStatsOf(kind ProjectileKind) ProjectileStats {
	if IsWeapon(kind) {
		return WeaponStatsOf(WeaponID(kind)).ProjectileStats
	}
	if kind == ProjectileShard {
		return ShardStats()
	}

	return EnemyBulletStatsOf(EnemyBulletID(kind))
}

// ProjectileSpawn is where a projectile starts, which way, and what it is.
type ProjectileSpawn struct {
	Kind  ProjectileKind
	X     float64
	Y     float64
	Angle float64
	// Curve bends the shot sideways by Curve*f*f at f px along its line,
	// positive to its left; 0 flies straight (#137).
	Curve float64
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
	// Shard is a burst shard's number, from 1, under its shot's id.
	Shard int
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
	// Curve bends it sideways, as its spawn's.
	Curve float64
	Age   float64
	X     float64
	Y     float64
	// BaseAge is the age at which the origin and angle were last set: 0,
	// unless a seeking shot turned (#72).
	BaseAge float64
	// Shard is a burst shard's number, from 1; 0 for any other projectile.
	Shard int
	// PiercesLeft is how many more enemies a shot carries on through.
	PiercesLeft int
	// hitIDs are the enemies it hit, so a piercing shot hits each once.
	hitIDs [maxHits]int
	hits   int
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
	along := Traveled(stats, age) - Traveled(stats, p.BaseAge)
	lateral := stats.Zigzag.Amplitude*TriangleWave(age*stats.Zigzag.Frequency) + p.Curve*along*along
	offset := RotateOffset(along, lateral, p.Angle)

	return Vec{X: p.OriginX + offset.X, Y: p.OriginY + offset.Y}
}

// HeadingAt is the way p points at the given age: its angle, turned along
// its curve.
func HeadingAt(p *Projectile, age float64) float64 {
	if p.Curve == 0 {
		return p.Angle
	}
	stats := ProjectileStatsOf(p.Kind)
	along := Traveled(stats, age) - Traveled(stats, p.BaseAge)

	return p.Angle + math.Atan(2*p.Curve*along)
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
	chosen.Curve = shot.Curve
	chosen.Age = opts.AgeSeconds
	chosen.BaseAge, chosen.Shard, chosen.hits = 0, opts.Shard, 0
	chosen.PiercesLeft = 0
	if IsWeapon(shot.Kind) {
		chosen.PiercesLeft = WeaponStatsOf(WeaponID(shot.Kind)).Pierce
	}
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

// SlotOf is q's index among the pool's items, or -1.
func (p *Pool) SlotOf(q *Projectile) int {
	for i := range p.items {
		if &p.items[i] == q {
			return i
		}
	}

	return -1
}

// Steer turns every seeking projectile of faction toward the nearest target
// within its cone and range, by at most its turn rate over dt. A turn
// re-bases it: it flies on straight from where it is, along the new heading.
func (p *Pool) Steer(dt float64, faction Faction, targets []Vec) {
	for i := range p.items {
		q := &p.items[i]
		if !q.Active || q.Faction != faction || !IsWeapon(q.Kind) {
			continue
		}
		seek := WeaponStatsOf(WeaponID(q.Kind)).Seek
		if seek.TurnRate == 0 {
			continue
		}
		off, ok := nearestAhead(q, seek, targets)
		if !ok {
			continue
		}
		turn := math.Max(-seek.TurnRate*dt, math.Min(seek.TurnRate*dt, off))
		q.OriginX, q.OriginY, q.BaseAge = q.X, q.Y, q.Age
		q.Angle = WrapAngle(q.Angle + turn)
	}
}

// nearestAhead is how far off q's heading the nearest target in its cone
// and range is.
func nearestAhead(q *Projectile, seek Seek, targets []Vec) (float64, bool) {
	best := math.Inf(1)
	var off float64
	found := false
	for _, t := range targets {
		d := math.Hypot(t.X-q.X, t.Y-q.Y)
		angle := WrapAngle(math.Atan2(t.Y-q.Y, t.X-q.X) - q.Angle)
		if d <= seek.Range && math.Abs(angle) <= seek.Cone && d < best {
			best, off, found = d, angle, true
		}
	}

	return off, found
}

// HasHit reports whether q already hit target id.
func (q *Projectile) HasHit(id int) bool {
	return slices.Contains(q.hitIDs[:q.hits], id)
}

// Hit records that q hit target id, and reports whether it carries on
// through: a piercing shot with pierces left.
func (q *Projectile) Hit(id int) bool {
	if q.hits < maxHits {
		q.hitIDs[q.hits] = id
		q.hits++
	}
	if q.PiercesLeft > 0 {
		q.PiercesLeft--

		return true
	}
	q.Active = false

	return false
}

// SkipHitsOf makes q leave alone the enemies from already hit: a burst's
// shards fly out past the enemy their ball struck.
func (q *Projectile) SkipHitsOf(from *Projectile) {
	q.hitIDs, q.hits = from.hitIDs, from.hits
}

// ShotDamage is what a projectile of kind does to an enemy it hits.
func ShotDamage(kind ProjectileKind) float64 {
	if kind == ProjectileShard {
		return WeaponStatsOf(WeaponBigSpaceGun).Burst.Damage
	}

	return WeaponStatsOf(WeaponID(kind)).Damage
}

// BurstSeed is the seed of a shot's burst, the same on every screen: from
// its owner (a player or a companion's seat) and its shot id.
func BurstSeed(owner string, shotID int) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(owner + "/" + strconv.Itoa(shotID)))

	return h.Sum32()
}

// BurstPattern is the star of shards a shot of weapon scatters from (x, y),
// turned by its seed; none for a weapon that doesn't burst.
func BurstPattern(weapon WeaponID, x, y float64, seed uint32) []ProjectileSpawn {
	burst := WeaponStatsOf(weapon).Burst
	if burst.Shards == 0 {
		return nil
	}
	step := Tau / float64(burst.Shards)
	turn := NewRandom(seed).Next() * step
	out := make([]ProjectileSpawn, burst.Shards)
	for k := range out {
		out[k] = ProjectileSpawn{Kind: ProjectileShard, X: x, Y: y, Angle: turn + step*float64(k)}
	}

	return out
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
