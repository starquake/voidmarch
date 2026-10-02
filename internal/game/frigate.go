package game

import (
	"maps"
	"math"
	"slices"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
	"github.com/starquake/voidmarch/internal/world"
)

// The Frigate's fight, in hub ticks and world pixels (#89); its rules are
// the sim's.
const (
	frigateEscorts      = 3
	frigateEscortRadius = 120
	// frigateMargin keeps a Frigate's patrol this far in from its sector's
	// sides (#121).
	frigateMargin = 200
	// frigatePatrolSpeed is how fast a Frigate drifts around its sector, in
	// px/s, while no ship is within its fire range.
	frigatePatrolSpeed = 20
	// frigateQuarterTurnSeconds is how long a patrolling Frigate takes to
	// turn a quarter of the way round to where it's going.
	frigateQuarterTurnSeconds = 2
	// frigatePatrolTurn is that turn rate in radians per hub tick.
	frigatePatrolTurn = quarterTurn / (frigateQuarterTurnSeconds * TickRate)
	// frigateDerelictOffset is how far below its Frigate a held derelict
	// waits (#114).
	frigateDerelictOffset = 160
	frigateRingEvery      = sim.FrigateRingInterval * TickRate
	frigateShieldTicks    = sim.FrigateShieldDelay * TickRate
	frigateRespawnTicks   = sim.FrigateRespawn * TickRate
	// frigateFireRange stays inside the big bullet's reach (130 px/s for 3 s).
	frigateFireRange = 380
)

// frigateSpot is the sector the map puts a Frigate in (#89): the one there
// now, or the tick the next one arrives.
type frigateSpot struct {
	sector    sim.Sector
	enemyID   uint32
	respawnAt uint32
	// once marks an attack's Frigate (#102): it comes even to a cleared
	// sector, and never comes back.
	once bool
}

// frigateFight is a Frigate's state beyond an enemy's: its health follows
// the weight of the players online (#132), and its shield recharges all at
// once after a while without a hit.
type frigateFight struct {
	spot int
	// goal is the point in its sector it patrols toward (#121).
	goal    point
	maxHP   int
	shield  int
	lastHit uint32
	weight  float64
	// engaged is whether a ship has been near since it last healed.
	engaged bool
}

// upShip is a ship that's up: its seat, where it is, and its weight, a
// player 1 and a companion sim.FrigateCompanionWeight.
type upShip struct {
	key    string
	at     point
	weight float64
}

// WithMap lays the world out from m: where its bosses sit (#89).
func WithMap(m *world.Map) HubOption {
	return func(o *hubOptions) {
		o.worldMap = m
	}
}

// frigateSpots are m's Frigate spots, free from the start; none without a map.
func frigateSpots(m *world.Map) []frigateSpot {
	if m == nil {
		return nil
	}
	var out []frigateSpot
	for _, s := range m.BossSectors("frigate") {
		out = append(out, frigateSpot{sector: s})
	}

	return out
}

// spawnFrigates puts a Frigate and its escorts at every free spot whose
// wait is over.
func (h *Hub) spawnFrigates() {
	for i := range h.frigates {
		spot := &h.frigates[i]
		if spot.enemyID != 0 || h.tick < spot.respawnAt || (h.cleared[spot.sector] && !spot.once) {
			continue
		}
		at := h.roamPoint(spot.sector, frigateMargin)
		h.nextEnemy++
		f := &enemy{
			id:       h.nextEnemy,
			kind:     pb.EnemyKind_ENEMY_KIND_FRIGATE,
			x:        at.x,
			y:        at.y,
			angle:    quarterTurn,
			cooldown: frigateRingEvery,
			lastNear: h.tick,
			frigate:  &frigateFight{spot: i, goal: at},
		}
		f.frigate.reset(f, h.onlineWeight())
		h.enemies[f.id] = f
		spot.enemyID = f.id
		for n := range frigateEscorts {
			angle := fullTurnFloat * float64(n) / frigateEscorts
			slot := point{
				frigateEscortRadius * math.Cos(angle),
				frigateEscortRadius * math.Sin(angle),
			}
			escort := h.addEnemyOf(pb.EnemyKind_ENEMY_KIND_FIGHTER, at.x+slot.x, at.y+slot.y)
			escort.escortOf, escort.post = f.id, slot
		}
		h.holdDerelictBeside(i, at)
	}
}

// holdDerelictBeside puts a held derelict beside Frigate spot i's Frigate
// at at, unless its last one is still waiting (#114).
func (h *Hub) holdDerelictBeside(i int, at point) {
	for _, d := range h.derelicts {
		if d.frigateSpot == i+1 {
			return
		}
	}
	id := h.holdDerelict(at.x, at.y+frigateDerelictOffset)
	h.derelicts[id].frigateSpot = i + 1
}

// reset heals the Frigate fully, scaled for weight.
func (f *frigateFight) reset(e *enemy, weight float64) {
	f.maxHP = int(sim.FrigateHP(weight))
	f.shield = sim.FrigateShield
	f.weight = weight
	f.engaged = false
	e.hp = f.maxHP
}

// scale rescales the Frigate to weight, keeping its share of health left.
func (f *frigateFight) scale(e *enemy, weight float64) {
	if weight == f.weight {
		return
	}
	maxHP := int(sim.FrigateHP(weight))
	if e.hp > 0 {
		e.hp = max(1, int(math.Round(float64(e.hp)*float64(maxHP)/float64(f.maxHP))))
	}
	f.maxHP, f.weight = maxHP, weight
}

// stepFrigate scales it to the players online, heals it once no ship near
// is up, recharges the shield, and turns to the nearest ship and fires its
// ring.
func (h *Hub) stepFrigate(e *enemy, ships []upShip, online float64) {
	f := e.frigate
	f.scale(e, online)
	e.lastNear = h.tick
	at := point{e.x, e.y}
	var near []upShip
	for _, s := range ships {
		if math.Hypot(s.at.x-at.x, s.at.y-at.y) <= sim.FrigateReach {
			near = append(near, s)
		}
	}
	if !slices.ContainsFunc(near, func(s upShip) bool {
		return math.Hypot(s.at.x-e.x, s.at.y-e.y) < frigateFireRange
	}) {
		h.patrol(e)
	}
	if len(near) == 0 {
		if f.engaged {
			f.reset(e, online)
		}

		return
	}
	f.engaged = true
	if f.shield < sim.FrigateShield && h.tick-f.lastHit >= frigateShieldTicks {
		f.shield = sim.FrigateShield
	}

	target, distance, _ := nearest(e, shipPoints(near))
	e.angle = math.Atan2(target.y-e.y, target.x-e.x)
	if e.cooldown > 0 {
		e.cooldown--
	}
	if e.cooldown <= 0 && distance < frigateFireRange {
		e.cooldown = frigateRingEvery
		h.fire(e)
	}
}

// patrol drifts a Frigate toward its goal, picking the next once there, and
// tows its held derelict along (#121).
func (h *Hub) patrol(e *enemy) {
	f := e.frigate
	dx, dy := f.goal.x-e.x, f.goal.y-e.y
	step := frigatePatrolSpeed * tickDuration
	e.angle = turnToward(e.angle, math.Atan2(dy, dx), frigatePatrolTurn)
	if d := math.Hypot(dx, dy); d <= step {
		e.x, e.y = f.goal.x, f.goal.y
		f.goal = h.roamPoint(h.frigates[f.spot].sector, frigateMargin)
	} else {
		e.x += dx / d * step
		e.y += dy / d * step
	}
	for _, d := range h.derelicts {
		if d.held && d.frigateSpot == f.spot+1 {
			d.x, d.y = e.x, e.y+frigateDerelictOffset
		}
	}
}

// takeHit is the damage left after the shield takes what it can.
func (f *frigateFight) takeHit(damage int, tick uint32) int {
	f.lastHit = tick
	absorbed := min(f.shield, damage)
	f.shield -= absorbed

	return damage - absorbed
}

// frigateDestroyed frees its spot until the Frigate comes back.
func (h *Hub) frigateDestroyed(e *enemy) {
	spot := &h.frigates[e.frigate.spot]
	spot.enemyID = 0
	spot.respawnAt = h.tick + frigateRespawnTicks
	if spot.once {
		spot.respawnAt = math.MaxUint32
	}
	h.clearIfDone(spot.sector)
}

// upShips are the ships that are up, players and companions alike, with
// their weights.
func (h *Hub) upShips() []upShip {
	var out []upShip
	for _, id := range slices.Sorted(maps.Keys(h.members)) {
		m := h.members[id]
		if m.gone {
			continue
		}
		if m.state != nil && !downed(m.state) {
			out = append(
				out,
				upShip{id, point{float64(m.state.GetX()), float64(m.state.GetY())}, 1},
			)
		}
		for _, c := range m.wing.Companions {
			if !c.Ship.Downed() {
				out = append(out, upShip{
					seatID(id, uint32(c.Number)), //nolint:gosec // companion numbers are small.
					point{c.Ship.X, c.Ship.Y},
					sim.FrigateCompanionWeight,
				})
			}
		}
	}

	return out
}

// onlineWeight is the weight of everyone online, downed or not, and their
// companions: what the bosses scale for (#132).
func (h *Hub) onlineWeight() float64 {
	var weight float64
	for _, m := range h.members {
		if m.gone {
			continue
		}
		weight += 1 + sim.FrigateCompanionWeight*float64(len(m.wing.Companions))
	}

	return weight
}

func shipPoints(ships []upShip) []point {
	out := make([]point, 0, len(ships))
	for _, s := range ships {
		out = append(out, s.at)
	}

	return out
}
