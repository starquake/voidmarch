package game

import (
	"maps"
	"math"
	"slices"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// What makes the later factions smarter (#9 decision 15, #138), in hub ticks
// and world pixels.
const (
	// dodgeReaction is how old a shot must be before an enemy reacts to it,
	// dodgeLook how far ahead of a shot it looks, and dodgeMargin how near
	// its line counts as coming at it.
	dodgeReaction = 4
	dodgeLook     = 160
	dodgeMargin   = 10
	// dodgeTicks is how long a sidestep lasts, dodgeRest how long before
	// the next, and dodgeStep how far aside it heads.
	dodgeTicks = 8
	dodgeRest  = 3 * TickRate / 2
	dodgeStep  = 120
)

// quarry is a ship an enemy can go for: where it is, how it moves, and how
// damaged its hull is.
type quarry struct {
	at     point
	vx, vy float64
	damage int
}

// relayedShot is a player's shot the hub has relayed, for dodging: the hub
// flies its companions' shots itself.
type relayedShot struct {
	shot sim.Projectile
	tick uint32
}

// quarries are the ships enemies go for: players and their companions
// alike, while they're up (#47), outside the safe zone.
func (h *Hub) quarries() []quarry {
	var out []quarry
	add := func(q quarry) {
		if math.Hypot(q.at.x, q.at.y) > safeRadius {
			out = append(out, q)
		}
	}
	for _, id := range slices.Sorted(maps.Keys(h.members)) {
		m := h.members[id]
		if s := m.state; s != nil && !downed(s) {
			add(quarry{
				at:     point{float64(s.GetX()), float64(s.GetY())},
				vx:     float64(s.GetVx()),
				vy:     float64(s.GetVy()),
				damage: int(s.GetDamage()),
			})
		}
		for _, c := range m.wing.Companions {
			if !c.Ship.Downed() {
				add(quarry{
					at: point{
						c.Ship.X,
						c.Ship.Y,
					},
					vx:     c.Ship.VX,
					vy:     c.Ship.VY,
					damage: c.Ship.Damage,
				})
			}
		}
	}

	return out
}

// quarryPoints are where qs are.
func quarryPoints(qs []quarry) []point {
	out := make([]point, 0, len(qs))
	for _, q := range qs {
		out = append(out, q.at)
	}

	return out
}

// pickQuarry is the ship e goes for and how far it is: the nearest, or for
// a faction that picks off the weak the most damaged within reach, the
// nearest of those.
func pickQuarry(
	e *enemy,
	qs []quarry,
	reach float64,
) (target quarry, distance float64, found bool) {
	weak := sim.FactionSmarts(e.faction).PickWeak
	distance = math.Inf(1)
	for _, q := range qs {
		d := math.Hypot(q.at.x-e.x, q.at.y-e.y)
		better := d < distance
		if weak && d <= reach {
			better = !found || distance > reach || q.damage > target.damage ||
				(q.damage == target.damage && d < distance)
		}
		if better {
			target, distance, found = q, d, true
		}
	}

	return target, distance, found
}

// aimAt is the angle e fires along at target: straight at it, or where it
// will be for a faction that leads its shots.
func aimAt(e *enemy, target quarry) float64 {
	if !sim.FactionSmarts(e.faction).Lead {
		return math.Atan2(target.at.y-e.y, target.at.x-e.x)
	}
	bullet := sim.EnemyBullet(simEnemyKind(e.kind), e.faction)
	warning := float64(fireWarning)
	if e.kind == pb.EnemyKind_ENEMY_KIND_TORPEDO {
		warning = torpedoWarning
	}

	return sim.LeadAngle(
		e.x, e.y,
		target.at.x, target.at.y, target.vx, target.vy,
		sim.EnemyBulletStatsOf(bullet).Speed,
		warning/TickRate,
	)
}

// bearing is the side of its target e takes: the way it came from, or for a
// flanking faction the bearing it drew when it spawned, so a pack spreads
// out around its target.
func bearing(e *enemy, target point) float64 {
	if sim.FactionSmarts(e.faction).Flank {
		return e.flank
	}

	return math.Atan2(e.y-target.y, e.x-target.x)
}

// noteShot keeps a player's shot for the enemies that dodge.
func (h *Hub) noteShot(shot *pb.ShotFired) {
	h.relayed = append(h.relayed, relayedShot{
		shot: sim.Projectile{
			Kind:    sim.ProjectileKind(simWeapon(shot.GetWeapon())),
			OriginX: float64(shot.GetX()),
			OriginY: float64(shot.GetY()),
			Angle:   float64(shot.GetAngle()),
		},
		tick: h.tick,
	})
}

// threats are the shots in flight an enemy can react to: players' shots at
// least dodgeReaction old, and the hub's companions' shots, as projectiles
// placed where they are now. Spent players' shots are forgotten.
func (h *Hub) threats() []sim.Projectile {
	var out []sim.Projectile
	kept := h.relayed[:0]
	for _, in := range h.relayed {
		age := float64(h.tick-in.tick) / TickRate
		if age > sim.ProjectileStatsOf(in.shot.Kind).Lifetime {
			continue
		}
		kept = append(kept, in)
		if h.tick-in.tick >= dodgeReaction {
			p := in.shot
			p.Age = age
			sim.Place(&p)
			out = append(out, p)
		}
	}
	h.relayed = kept
	for _, p := range h.shots.Items() {
		if p.Active && p.Faction == sim.FactionOwn {
			out = append(out, p)
		}
	}

	return out
}

// dodge starts a sidestep for an enemy of a dodging faction when a shot is
// coming at it, unless it's resting from the last one.
func (h *Hub) dodge(e *enemy, threats []sim.Projectile) {
	if !sim.FactionSmarts(e.faction).Dodge || h.tick < e.dodgeUntil+dodgeRest {
		return
	}
	reach := sim.EnemyRadius(simEnemyKind(e.kind), e.faction) + dodgeMargin
	for i := range threats {
		p := &threats[i]
		heading := sim.HeadingAt(p, p.Age)
		dx, dy := e.x-p.X, e.y-p.Y
		along := dx*math.Cos(heading) + dy*math.Sin(heading)
		across := -dx*math.Sin(heading) + dy*math.Cos(heading)
		if along <= 0 || along > dodgeLook || math.Abs(across) > reach {
			continue
		}
		side := math.Copysign(quarterTurn, across)
		if across == 0 {
			side = quarterTurn * e.strafe
		}
		e.dodgeAngle = heading + side
		e.dodgeUntil = h.tick + dodgeTicks

		return
	}
}

// simWeapon is a wire weapon in the sim.
func simWeapon(w pb.Weapon) sim.WeaponID {
	switch w {
	case pb.Weapon_WEAPON_ROCKETS:
		return sim.WeaponRockets
	case pb.Weapon_WEAPON_BIG_SPACE_GUN:
		return sim.WeaponBigSpaceGun
	case pb.Weapon_WEAPON_ZAPPER:
		return sim.WeaponZapper
	case pb.Weapon_WEAPON_UNSPECIFIED, pb.Weapon_WEAPON_AUTO_CANNON:
		fallthrough
	default:
		return sim.WeaponAutoCannon
	}
}
