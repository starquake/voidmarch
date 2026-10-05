package game

import (
	"maps"
	"math"
	"slices"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// Support Ships (#184): speeds in px/s, accelerations in px/s^2, distances
// in px, times in hub ticks.
const (
	supportHP           = 4
	supportMaxSpeed     = 70
	supportAcceleration = 180
	// supportBehind is how far past the middle of its pack a Support Ship
	// keeps, away from the ship they fight.
	supportBehind = 180
	// packReach is how near the ship they fight its faction's others have
	// to be to count in a Support Ship's pack.
	packReach = 400
	// repairRange is how near a Support Ship has to be to repair, and
	// repairEvery how long each point of hull or shield takes.
	repairRange = 200
	repairEvery = TickRate
)

// isSupport reports whether e is a Support Ship.
func (e *enemy) isSupport() bool {
	return e.kind == pb.EnemyKind_ENEMY_KIND_SUPPORT
}

// behindPack is where Support Ship e keeps while its pack fights target:
// supportBehind past the pack's middle, on the side away from target. It is
// false with no pack near target.
func (h *Hub) behindPack(e *enemy, target point) (point, bool) {
	var sumX, sumY float64
	n := 0
	for _, id := range slices.Sorted(maps.Keys(h.enemies)) {
		o := h.enemies[id]
		if o.isSupport() || o.faction != e.faction ||
			math.Hypot(o.x-target.x, o.y-target.y) > packReach {
			continue
		}
		sumX += o.x
		sumY += o.y
		n++
	}
	if n == 0 {
		return point{}, false
	}
	middle := point{sumX / float64(n), sumY / float64(n)}
	away := math.Atan2(middle.y-target.y, middle.x-target.x)
	if middle == target {
		away = math.Atan2(e.y-target.y, e.x-target.x)
	}

	return point{
		x: middle.x + supportBehind*math.Cos(away),
		y: middle.y + supportBehind*math.Sin(away),
	}, true
}

// stepRepairs has every Support Ship repair the enemy it's on, a point
// every repairEvery: the one it was on while that one still needs it and
// stays in range, else the most worn in range.
func (h *Hub) stepRepairs() {
	for _, id := range slices.Sorted(maps.Keys(h.enemies)) {
		e := h.enemies[id]
		if !e.isSupport() {
			continue
		}
		target := h.repairTarget(e)
		if target == nil {
			e.repairing = 0

			continue
		}
		if target.id != e.repairing {
			e.repairing, e.repairIn = target.id, repairEvery
		}
		if e.repairIn--; e.repairIn <= 0 {
			target.repair()
			e.repairIn = repairEvery
		}
	}
}

// repairTarget is the enemy Support Ship e repairs, or nil for none.
func (h *Hub) repairTarget(e *enemy) *enemy {
	inReach := func(o *enemy) bool {
		return o != nil && o != e && o.wear() > 0 &&
			math.Hypot(o.x-e.x, o.y-e.y) <= repairRange
	}
	if current := h.enemies[e.repairing]; inReach(current) {
		return current
	}
	var best *enemy
	for _, id := range slices.Sorted(maps.Keys(h.enemies)) {
		if o := h.enemies[id]; inReach(o) && (best == nil || o.wear() > best.wear()) {
			best = o
		}
	}

	return best
}

// wear is the share of its health and shield together that e has lost.
func (e *enemy) wear() float64 {
	lost := func(have, most float64) float64 {
		if most <= 0 {
			return 0
		}

		return (most - have) / most
	}
	switch {
	case e.frigate != nil:
		return lost(float64(e.hp+e.frigate.shield), float64(e.frigate.maxHP+sim.FrigateShield))
	case e.dread != nil:
		d := e.dread

		return lost(d.share*d.maxHP()+float64(d.shield), d.maxHP()+sim.DreadnoughtShield)
	default:
		return lost(float64(e.hp), float64(e.maxHP))
	}
}

// repair gives e a point back: its shield's first while that is down, then
// its health's, never past the most.
func (e *enemy) repair() {
	switch {
	case e.frigate != nil && e.frigate.shield < sim.FrigateShield:
		e.frigate.shield++
	case e.dread != nil && e.dread.shield < sim.DreadnoughtShield:
		e.dread.shield++
	case e.frigate != nil:
		e.hp = min(e.hp+1, e.frigate.maxHP)
	case e.dread != nil:
		e.dread.share = math.Min(1, e.dread.share+1/e.dread.maxHP())
		e.hp = e.dread.hp()
	default:
		e.hp = min(e.hp+1, e.maxHP)
	}
}
