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
	for range substeps {
		for _, id := range owners {
			m := h.members[id]
			if m == nil || m.state == nil || len(m.wing.Companions) == 0 {
				continue
			}
			m.wing.Observe(mover(m.state))
			for _, shot := range m.wing.Step(h.brainEnemies(m)) {
				h.fireCompanionShot(id, shot)
			}
		}
		h.stepCompanionShots()
	}
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

// stepCompanionShots moves the companions' shots one sim tick and applies
// those that hit an enemy on the way.
func (h *Hub) stepCompanionShots() {
	h.shots.Step(sim.TickSeconds, sim.ProjectileInBounds)
	if len(h.enemies) == 0 {
		return
	}
	targets := make([]sim.Target[uint32], 0, len(h.enemies))
	for _, id := range slices.Sorted(maps.Keys(h.enemies)) {
		e := h.enemies[id]
		targets = append(
			targets,
			sim.Target[uint32]{
				ID:     id,
				X:      e.x,
				Y:      e.y,
				Radius: sim.EnemyRadius(simEnemyKind(e.kind)),
			},
		)
	}
	items := h.shots.Items()
	for i := range items {
		p := &items[i]
		if !p.Active {
			continue
		}
		from := sim.PositionAt(p, math.Max(0, p.Age-sim.TickSeconds))
		target, ok := sim.HitTargetAlong(from.X, from.Y, p.X, p.Y, targets)
		if !ok {
			continue
		}
		p.Active = false
		damage := sim.WeaponStatsOf(sim.WeaponID(p.Kind)).Damage
		shotID := uint32(p.ShotID) //nolint:gosec // shot ids count up from 1.
		h.hit("", p.Owner, target.ID, shotID, uint32(damage))
	}
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
		},
		Damage: uint32(s.Damage), //nolint:gosec // hits taken, 0 to 3.
	}
}

func mover(s *pb.ShipState) sim.Mover {
	return sim.Mover{
		X:     float64(s.GetX()),
		Y:     float64(s.GetY()),
		VX:    float64(s.GetVx()),
		VY:    float64(s.GetVy()),
		Angle: float64(s.GetAngle()),
	}
}

func simEnemyKind(kind pb.EnemyKind) sim.EnemyKind {
	if kind == pb.EnemyKind_ENEMY_KIND_FIGHTER {
		return sim.EnemyFighter
	}

	return sim.EnemyScout
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
