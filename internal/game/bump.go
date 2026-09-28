package game

import (
	"maps"
	"slices"
	"strconv"

	"github.com/starquake/voidmarch/internal/sim"
)

// bumper is one body the hub bumps: a player's ship, which only its own
// client moves, or a companion or enemy, which the hub moves.
type bumper struct {
	key  string
	body sim.Body
	// ship is set for a companion, enemy for an enemy; neither for a player.
	ship  *sim.Ship
	enemy *enemy
	// seat is a companion's seat, credited with the enemies it rams.
	seat string
}

func (b *bumper) movable() bool { return b.ship != nil || b.enemy != nil }

// place writes the body back into the companion or enemy it came from.
func (b *bumper) place() {
	switch {
	case b.ship != nil:
		b.ship.MoveTo(b.body)
	case b.enemy != nil:
		b.enemy.x, b.enemy.y, b.enemy.vx, b.enemy.vy = b.body.X, b.body.Y, b.body.VX, b.body.VY
	default:
		// A player's ship: its own client moves it.
	}
}

// A body the hub moves takes the whole push from a player's ship, and half
// when the other moves too.
const (
	wholePush  = 1.0
	sharedPush = 0.5
)

// ramPair names two bodies for the ram cooldown, in a fixed order.
type ramPair struct{ a, b string }

// bumpShips pushes companions and enemies out of each other and out of the
// players' ships, and applies rams: to a companion's shield or hull, and to
// an enemy a companion rams. A player's own client counts its rams.
func (h *Hub) bumpShips() {
	now := float64(h.tick) * tickDuration
	bodies := h.bumpers()
	for i := range bodies {
		for j := i + 1; j < len(bodies); j++ {
			h.bump(&bodies[i], &bodies[j], now)
		}
	}
	for i := range bodies {
		bodies[i].place()
	}
	h.rams.Forget(now)
}

// bumpers are every ship and enemy in a fixed order.
func (h *Hub) bumpers() []bumper {
	var out []bumper
	for _, id := range slices.Sorted(maps.Keys(h.members)) {
		m := h.members[id]
		if m.state != nil {
			s := m.state
			out = append(out, bumper{key: id, body: sim.Body{
				X: float64(s.GetX()), Y: float64(s.GetY()),
				VX: float64(s.GetVx()), VY: float64(s.GetVy()),
				Radius: sim.ShipRadius,
			}})
		}
		for _, c := range m.wing.Companions {
			seat := seatID(id, uint32(c.Number)) //nolint:gosec // companion numbers are small.
			out = append(
				out,
				bumper{key: seat, body: sim.ShipBody(c.Ship), ship: c.Ship, seat: seat},
			)
		}
	}
	for _, id := range slices.Sorted(maps.Keys(h.enemies)) {
		e := h.enemies[id]
		out = append(out, bumper{
			key: "enemy " + strconv.FormatUint(uint64(e.id), 10),
			body: sim.Body{
				X:      e.x,
				Y:      e.y,
				VX:     e.vx,
				VY:     e.vy,
				Radius: sim.EnemyRadius(simEnemyKind(e.kind)),
			},
			enemy: e,
		})
	}

	return out
}

// bump pushes a and b apart, the ones the hub moves sharing the push, and
// applies a ram between them.
func (h *Hub) bump(a, b *bumper, now float64) {
	if !a.movable() && !b.movable() {
		return
	}
	c, ok := sim.Touching(a.body, b.body, 1)
	if !ok {
		return
	}
	back, _ := sim.Touching(b.body, a.body, -1)
	share := wholePush
	if a.movable() && b.movable() {
		share = sharedPush
	}
	if a.movable() {
		a.body = sim.Apart(a.body, c, share)
	}
	if b.movable() {
		b.body = sim.Apart(b.body, back, share)
	}
	if !c.Hurts() || !h.rams.Ready(ramPair{a.key, b.key}, now) {
		return
	}
	h.rammed(a, b, c)
	h.rammed(b, a, back)
}

// rammed applies a ram on target by other: a companion takes the hit, and
// an enemy rammed by a companion takes RammingDamage credited to it.
func (h *Hub) rammed(target, other *bumper, c sim.Contact) {
	switch {
	case target.ship != nil:
		sim.TakeHit(target.ship, c.From())
	case target.enemy != nil && other.seat != "":
		if _, alive := h.enemies[target.enemy.id]; alive {
			h.hit("", other.seat, target.enemy.id, 0, sim.RammingDamage)
		}
	default:
		// Players count their own rams, and enemies don't hurt each other.
	}
}
