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
	frigateRingEvery    = sim.FrigateRingInterval * TickRate
	frigateShieldTicks  = sim.FrigateShieldDelay * TickRate
	frigateRespawnTicks = sim.FrigateRespawn * TickRate
	// frigateFireRange stays inside the big bullet's reach (130 px/s for 3 s).
	frigateFireRange = 380
)

// frigateSpot is where the map puts a Frigate (#89): the one there now, or
// the tick the next one arrives.
type frigateSpot struct {
	at        point
	enemyID   uint32
	respawnAt uint32
}

// frigateFight is a Frigate's state beyond an enemy's: its health grows by a
// share for every ship that comes near, counted once, and its shield
// recharges all at once after a while without a hit.
type frigateFight struct {
	spot    int
	maxHP   int
	shield  int
	lastHit uint32
	weight  float64
	counted map[string]bool
}

// upShip is a ship that's up, as the Frigate counts it: its seat, where it
// is, and its share of the Frigate's health.
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
	for _, s := range m.Spots("frigate") {
		out = append(out, frigateSpot{at: point{x: s[0], y: s[1]}})
	}

	return out
}

// spawnFrigates puts a Frigate and its escorts at every free spot whose
// wait is over.
func (h *Hub) spawnFrigates() {
	for i := range h.frigates {
		spot := &h.frigates[i]
		if spot.enemyID != 0 || h.tick < spot.respawnAt {
			continue
		}
		h.nextEnemy++
		f := &enemy{
			id:       h.nextEnemy,
			kind:     pb.EnemyKind_ENEMY_KIND_FRIGATE,
			x:        spot.at.x,
			y:        spot.at.y,
			angle:    quarterTurn,
			cooldown: frigateRingEvery,
			lastNear: h.tick,
			frigate:  &frigateFight{spot: i},
		}
		f.frigate.reset(f)
		h.enemies[f.id] = f
		spot.enemyID = f.id
		for n := range frigateEscorts {
			angle := fullTurnFloat * float64(n) / frigateEscorts
			escort := h.addEnemyOf(
				pb.EnemyKind_ENEMY_KIND_FIGHTER,
				spot.at.x+frigateEscortRadius*math.Cos(angle),
				spot.at.y+frigateEscortRadius*math.Sin(angle),
			)
			escort.escortOf = f.id
		}
	}
}

// reset heals the Frigate fully, for nobody, and puts it back on its spot.
func (f *frigateFight) reset(e *enemy) {
	f.maxHP = sim.FrigateBaseHP
	f.shield = sim.FrigateShield
	f.weight = 0
	f.counted = map[string]bool{}
	e.hp = f.maxHP
}

// stepFrigate counts the ships that came near, resets once none near is up,
// recharges the shield, and turns to the nearest ship and fires its ring.
func (h *Hub) stepFrigate(e *enemy, ships []upShip) {
	f := e.frigate
	e.lastNear = h.tick
	at := point{e.x, e.y}
	var near []upShip
	for _, s := range ships {
		if math.Hypot(s.at.x-at.x, s.at.y-at.y) <= sim.FrigateReach {
			near = append(near, s)
		}
	}
	if len(near) == 0 {
		if len(f.counted) > 0 {
			spot := h.frigates[f.spot].at
			e.x, e.y = spot.x, spot.y
			f.reset(e)
		}

		return
	}
	for _, s := range near {
		if !f.counted[s.key] {
			f.counted[s.key] = true
			f.weight += s.weight
			share := int(sim.FrigateHPPerPlayer * s.weight)
			f.maxHP += share
			e.hp += share
		}
	}
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

// takeHit is the damage left after the shield takes what it can.
func (f *frigateFight) takeHit(damage int, tick uint32) int {
	f.lastHit = tick
	absorbed := min(f.shield, damage)
	f.shield -= absorbed

	return damage - absorbed
}

// frigateDestroyed frees its spot until the Frigate comes back, and
// releases a derelict where it went down (#52).
func (h *Hub) frigateDestroyed(e *enemy) {
	spot := &h.frigates[e.frigate.spot]
	spot.enemyID = 0
	spot.respawnAt = h.tick + frigateRespawnTicks
	h.releaseDerelict(e.x, e.y, 0)
}

// upShips are the ships that are up, players and companions alike, with the
// share each adds to a Frigate's health.
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

func shipPoints(ships []upShip) []point {
	out := make([]point, 0, len(ships))
	for _, s := range ships {
		out = append(out, s.at)
	}

	return out
}
