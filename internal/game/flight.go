package game

import (
	"maps"
	"math"
	"slices"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

const (
	// substeps is how many sim ticks the hub runs per tick, so companions fly
	// at the sim's rate like every client's own ship.
	substeps = sim.TickRate / TickRate
	// shotCapacity is the companions' shots in flight: 15 companions at the
	// auto cannon's rate, with room to spare.
	shotCapacity = 512
)

// flyCompanions steps every companion for one hub tick: each follows its
// owner's latest state and fights the enemies it sees. Their shots go to
// every client and are tested against the enemies here.
func (h *Hub) flyCompanions() {
	owners := slices.Sorted(maps.Keys(h.members))
	derelicts := h.derelictPoints()
	for range substeps {
		for _, id := range owners {
			m := h.members[id]
			if m == nil || len(m.wing.Companions) == 0 || (m.state == nil && !m.gone) {
				continue
			}
			owner := m.last
			if m.state != nil {
				owner = mover(m.state)
			}
			m.wing.Observe(owner)
			m.wing.Derelicts = derelicts
			m.wing.Frontier = h.frontier
			for _, shot := range m.wing.Step(h.brainEnemies(m), h.othersThan(id)) {
				h.fireCompanionShot(id, shot)
			}
		}
		h.stepCompanionShots()
	}
}

// othersThan are the ships of every member but id and their companions,
// which id's companions keep clear of, revive, and are revived by.
func (h *Hub) othersThan(id string) []sim.Friend {
	squadron := h.members[id].squadron
	var out []sim.Friend
	for _, other := range slices.Sorted(maps.Keys(h.members)) {
		if other == id {
			continue
		}
		m := h.members[other]
		mate := squadron != "" && m.squadron == squadron
		if m.state != nil {
			out = append(out, sim.Friend{
				X: float64(m.state.GetX()), Y: float64(m.state.GetY()),
				Squadmate: mate, Downed: downed(m.state),
			})
		}
		for _, c := range m.wing.Companions {
			out = append(
				out,
				sim.Friend{X: c.Ship.X, Y: c.Ship.Y, Squadmate: mate, Downed: c.Ship.Downed()},
			)
		}
	}

	return out
}

// brainEnemies are the enemies as m's companions see them.
func (h *Hub) brainEnemies(m *member) []sim.BrainEnemy {
	out := make([]sim.BrainEnemy, 0, len(h.enemies))
	for _, id := range slices.Sorted(maps.Keys(h.enemies)) {
		e := h.enemies[id]
		out = append(out, sim.BrainEnemy{
			ID:           int(id),
			Kind:         simEnemyKind(e.kind),
			X:            e.x,
			Y:            e.y,
			AttackedWing: m.attackers[id],
		})
	}

	return out
}

// fireCompanionShot starts a companion's shot on the hub and on every client.
func (h *Hub) fireCompanionShot(owner string, shot sim.CompanionShot) {
	seat := seatID(owner, uint32(shot.Companion)) //nolint:gosec // companion numbers are small.
	p := h.shots.Spawn(
		sim.ProjectileSpawn{
			Kind:  sim.ProjectileKind(shot.Weapon),
			X:     shot.X,
			Y:     shot.Y,
			Angle: shot.Angle,
		},
		sim.SpawnOptions{Owner: seat},
	)
	h.broadcast(&pb.ServerMessage{Kind: &pb.ServerMessage_Shot{Shot: &pb.RemoteShot{
		PlayerId: seat,
		Tick:     h.tick,
		Shot: &pb.ShotFired{
			Id:        uint32(p.ShotID), //nolint:gosec // shot ids count up from 1.
			Weapon:    pbWeapon(shot.Weapon),
			Muzzle:    uint32(shot.Muzzle), //nolint:gosec // a weapon has one or two muzzles.
			X:         float32(shot.X),
			Y:         float32(shot.Y),
			Angle:     float32(shot.Angle),
			Companion: uint32(shot.Companion), //nolint:gosec // companion numbers are small.
		},
	}}}, "")
}

// volley is an enemy's volley, announced to clients with a warning and
// fired at tick from wherever the enemy is by then, as clients fire it.
type volley struct {
	tick    uint32
	enemyID uint32
	angle   float64
	seed    uint32
}

// volleyRange is how close a companion must be to an enemy for the hub to
// fly its volley; clients skip the ones past the same range.
const volleyRange = 800

// fireVolleys puts the volleys due by now into the hub's projectiles, the
// same bullets every client expands from the same seed. A volley from an
// enemy shot down meanwhile never leaves, and one with no companion in
// reach isn't flown.
func (h *Hub) fireVolleys() {
	var companions []point
	for _, m := range h.members {
		for _, c := range m.wing.Companions {
			companions = append(companions, point{c.Ship.X, c.Ship.Y})
		}
	}
	pending := h.volleys[:0]
	for _, v := range h.volleys {
		if v.tick > h.tick {
			pending = append(pending, v)

			continue
		}
		e, ok := h.enemies[v.enemyID]
		if !ok || !withinReach(point{e.x, e.y}, companions) {
			continue
		}
		for _, bullet := range sim.EnemyPattern(simEnemyKind(e.kind), e.x, e.y, v.angle, v.seed) {
			h.shots.Spawn(bullet, sim.SpawnOptions{Faction: sim.FactionEnemy})
		}
	}
	h.volleys = pending
}

// withinReach reports whether any companion is within volleyRange of p.
func withinReach(p point, companions []point) bool {
	return slices.ContainsFunc(companions, func(c point) bool {
		return math.Hypot(c.x-p.x, c.y-p.y) <= volleyRange
	})
}

// stepCompanionShots moves the hub's projectiles one sim tick: companions'
// shots that hit an enemy count, and enemy bullets that hit a companion
// wear its shield or hull.
func (h *Hub) stepCompanionShots() {
	h.shots.Steer(sim.TickSeconds, sim.FactionOwn, h.enemyPoints())
	for _, p := range h.shots.Step(sim.TickSeconds, sim.ProjectileInBounds) {
		h.burst(p)
	}
	enemies := h.enemyTargets()
	companions, ships := h.companionTargets()
	items := h.shots.Items()
	for i := range items {
		p := &items[i]
		if !p.Active {
			continue
		}
		from := sim.PositionAt(p, math.Max(0, p.Age-sim.TickSeconds))
		switch p.Faction {
		case sim.FactionEnemy:
			if i, direction, ok := sim.FirstShipHit(companions, from.X, from.Y, p.X, p.Y); ok {
				p.Active = false
				sim.TakeHit(ships[i], direction)
				// Its shield may be spent now, for the next bullet this step.
				companions[i] = sim.TargetOf(ships[i])
			}
		case sim.FactionOwn, sim.FactionRemote:
			fallthrough
		default:
			skip := func(id uint32) bool { return p.HasHit(int(id)) }
			target, ok := sim.HitTargetAlongExcept(from.X, from.Y, p.X, p.Y, enemies, skip)
			if !ok {
				continue
			}
			goesOn := p.Hit(int(target.ID))
			//nolint:gosec // shot ids count up from 1, shards from 1 to a burst's size.
			shot := shotHit{id: uint32(p.ShotID), shard: uint32(p.Shard), goesOn: goesOn}
			h.hit("", p.Owner, target.ID, shot, uint32(sim.ShotDamage(p.Kind)))
			if !goesOn {
				h.burst(p)
			}
			// The enemy may be gone now: test the rest against the ones left.
			enemies = h.enemyTargets()
		}
	}
}

// burst scatters the star of a companion's big space gun ball where it
// ended, as every client does for the same shot (#72).
func (h *Hub) burst(p *sim.Projectile) {
	if p.Faction != sim.FactionOwn || !sim.IsWeapon(p.Kind) {
		return
	}
	seed := sim.BurstSeed(p.Owner, p.ShotID)
	for k, shard := range sim.BurstPattern(sim.WeaponID(p.Kind), p.X, p.Y, seed) {
		h.shots.Spawn(shard, sim.SpawnOptions{Owner: p.Owner, ShotID: p.ShotID, Shard: k + 1}).
			SkipHitsOf(p)
	}
}

// enemyPoints are where the enemies are, for seeking shots.
func (h *Hub) enemyPoints() []sim.Vec {
	out := make([]sim.Vec, 0, len(h.enemies))
	for _, id := range slices.Sorted(maps.Keys(h.enemies)) {
		out = append(out, sim.Vec{X: h.enemies[id].x, Y: h.enemies[id].y})
	}

	return out
}

// enemyTargets are the enemies as hit circles.
func (h *Hub) enemyTargets() []sim.Target[uint32] {
	out := make([]sim.Target[uint32], 0, len(h.enemies))
	for _, id := range slices.Sorted(maps.Keys(h.enemies)) {
		e := h.enemies[id]
		out = append(
			out,
			sim.Target[uint32]{
				ID:     id,
				X:      e.x,
				Y:      e.y,
				Radius: sim.EnemyRadius(simEnemyKind(e.kind)),
			},
		)
	}

	return out
}

// companionTargets are every companion as enemy bullets meet it, with its
// ship at the same index.
func (h *Hub) companionTargets() ([]sim.ShipTarget, []*sim.Ship) {
	var targets []sim.ShipTarget
	var ships []*sim.Ship
	for _, id := range slices.Sorted(maps.Keys(h.members)) {
		for _, c := range h.members[id].wing.Companions {
			// Bullets pass a downed ship (#47).
			if !c.Ship.Downed() {
				targets = append(targets, sim.TargetOf(c.Ship))
				ships = append(ships, c.Ship)
			}
		}
	}

	return targets, ships
}

// noteAttack marks e as an attacker of every wing it fired near, which
// defensive orders and return fire answer.
func (h *Hub) noteAttack(e *enemy) {
	near := func(x, y float64) bool {
		return math.Hypot(x-e.x, y-e.y) <= sim.BrainAttackerRange
	}
	for _, m := range h.members {
		attacked := m.state != nil && near(float64(m.state.GetX()), float64(m.state.GetY()))
		for _, c := range m.wing.Companions {
			attacked = attacked || near(c.Ship.X, c.Ship.Y)
		}
		if attacked {
			m.attackers[e.id] = true
		}
	}
}

// forgetEnemy drops a gone enemy from every wing's attackers.
func (h *Hub) forgetEnemy(id uint32) {
	for _, m := range h.members {
		delete(m.attackers, id)
	}
}

// squadronModeOrders are the standing orders of m's squadron's mode, holding
// at m's ship in Hold.
func (h *Hub) squadronModeOrders(m *member) sim.Orders {
	mode := sim.ModeEscort
	if sq := h.squadrons[m.squadron]; sq != nil {
		mode = simMode(sq.mode)
	}

	return sim.ModeOrders(
		mode,
		sim.DefaultOrders(),
		float64(m.state.GetX()),
		float64(m.state.GetY()),
	)
}

// orderWing gives every companion in m's wing an order from the squadron.
func orderWing(m *member, order *pb.SquadronOrder) {
	mode, oneShot := order.GetMode(), order.GetOneShot()
	x, y := float64(order.GetX()), float64(order.GetY())
	for _, c := range m.wing.Companions {
		next, ok := m.wing.OrdersFor(c), false
		switch {
		case mode != pb.CompanionMode_COMPANION_MODE_UNSPECIFIED:
			next, ok = sim.ModeOrders(simMode(mode), next, x, y), true
		case oneShot != pb.CompanionOneShot_COMPANION_ONE_SHOT_UNSPECIFIED:
			next, ok = sim.WithOneShot(simOneShot(oneShot), next, int(order.GetFocusEnemyId()))
		default:
		}
		if ok {
			m.wing.Order(c, next)
		}
	}
}

// companionState is a companion's ship as the protocol has it.
func companionState(c *sim.Companion) *pb.ShipState {
	s := c.Ship

	return &pb.ShipState{
		X:         float32(s.X),
		Y:         float32(s.Y),
		Vx:        float32(s.VX),
		Vy:        float32(s.VY),
		Angle:     float32(s.Angle),
		Thrusting: s.Thrusting,
		Loadout: &pb.Loadout{
			Weapon: pbWeapon(s.Loadout.Weapon),
			Engine: pbEngine(s.Loadout.Engine),
			Shield: pbShield(s.Loadout.Shield),
			//nolint:gosec // tiers are 0 to 3.
			WeaponTier: uint32(s.Loadout.WeaponTier),
			EngineTier: uint32(s.Loadout.EngineTier), //nolint:gosec // tiers are 0 to 3.
			ShieldTier: uint32(s.Loadout.ShieldTier), //nolint:gosec // tiers are 0 to 3.
		},
		Damage: uint32(s.Damage), //nolint:gosec // hits taken, 0 to 3.
		Shield: float32(s.Shield),
		Revive: float32(s.Revive),
	}
}

func mover(s *pb.ShipState) sim.Mover {
	return sim.Mover{
		X:      float64(s.GetX()),
		Y:      float64(s.GetY()),
		VX:     float64(s.GetVx()),
		VY:     float64(s.GetVy()),
		Angle:  float64(s.GetAngle()),
		Downed: downed(s),
	}
}

// downed reports whether a player's reported ship is down (#47).
func downed(s *pb.ShipState) bool {
	return s.GetDamage() >= sim.MaxDamage
}

func simEnemyKind(kind pb.EnemyKind) sim.EnemyKind {
	switch kind {
	case pb.EnemyKind_ENEMY_KIND_FIGHTER:
		return sim.EnemyFighter
	case pb.EnemyKind_ENEMY_KIND_FRIGATE:
		return sim.EnemyFrigate
	case pb.EnemyKind_ENEMY_KIND_UNSPECIFIED, pb.EnemyKind_ENEMY_KIND_SCOUT:
		fallthrough
	default:
		return sim.EnemyScout
	}
}

func simMode(mode pb.CompanionMode) sim.Mode {
	switch mode {
	case pb.CompanionMode_COMPANION_MODE_ATTACK:
		return sim.ModeAttack
	case pb.CompanionMode_COMPANION_MODE_GUARD:
		return sim.ModeGuard
	case pb.CompanionMode_COMPANION_MODE_HOLD:
		return sim.ModeHold
	case pb.CompanionMode_COMPANION_MODE_STEALTH:
		return sim.ModeStealth
	case pb.CompanionMode_COMPANION_MODE_ESCORT, pb.CompanionMode_COMPANION_MODE_UNSPECIFIED:
		fallthrough
	default:
		return sim.ModeEscort
	}
}

func simOneShot(kind pb.CompanionOneShot) sim.OneShotKind {
	switch kind {
	case pb.CompanionOneShot_COMPANION_ONE_SHOT_FOCUS:
		return sim.OneShotFocus
	case pb.CompanionOneShot_COMPANION_ONE_SHOT_REGROUP:
		return sim.OneShotRegroup
	case pb.CompanionOneShot_COMPANION_ONE_SHOT_GO_HOME:
		return sim.OneShotGoHome
	case pb.CompanionOneShot_COMPANION_ONE_SHOT_UNSPECIFIED:
		fallthrough
	default:
		return sim.OneShotNone
	}
}

func pbWeapon(id sim.WeaponID) pb.Weapon {
	switch id {
	case sim.WeaponRockets:
		return pb.Weapon_WEAPON_ROCKETS
	case sim.WeaponBigSpaceGun:
		return pb.Weapon_WEAPON_BIG_SPACE_GUN
	case sim.WeaponZapper:
		return pb.Weapon_WEAPON_ZAPPER
	case sim.WeaponAutoCannon:
		fallthrough
	default:
		return pb.Weapon_WEAPON_AUTO_CANNON
	}
}

func pbEngine(id sim.EngineID) pb.Engine {
	switch id {
	case sim.EngineBigPulse:
		return pb.Engine_ENGINE_BIG_PULSE
	case sim.EngineBurst:
		return pb.Engine_ENGINE_BURST
	case sim.EngineSupercharged:
		return pb.Engine_ENGINE_SUPERCHARGED
	case sim.EngineBase:
		fallthrough
	default:
		return pb.Engine_ENGINE_BASE
	}
}

func pbShield(id sim.ShieldID) pb.Shield {
	switch id {
	case sim.ShieldFrontAndSide:
		return pb.Shield_SHIELD_FRONT_AND_SIDE
	case sim.ShieldRound:
		return pb.Shield_SHIELD_ROUND
	case sim.ShieldInvincibility:
		return pb.Shield_SHIELD_INVINCIBILITY
	case sim.ShieldFront:
		fallthrough
	default:
		return pb.Shield_SHIELD_FRONT
	}
}

// simLoadout is a wire loadout as the sim's; unknown parts are the defaults.
func simLoadout(l *pb.Loadout) sim.Loadout {
	out := sim.DefaultLoadout()
	for _, w := range sim.Weapons() {
		if pbWeapon(w) == l.GetWeapon() {
			out.Weapon = w
		}
	}
	for _, e := range sim.Engines() {
		if pbEngine(e) == l.GetEngine() {
			out.Engine = e
		}
	}
	for _, s := range sim.Shields() {
		if pbShield(s) == l.GetShield() {
			out.Shield = s
		}
	}
	out.WeaponTier = simTier(l.GetWeaponTier())
	out.EngineTier = simTier(l.GetEngineTier())
	out.ShieldTier = simTier(l.GetShieldTier())

	return out
}

// simTier is a wire tier held to plain through Hyper.
func simTier(t uint32) sim.Tier {
	return sim.Tier(min(t, uint32(sim.TierHyper)))
}
