package game

import (
	"maps"
	"math"
	"slices"
	"strings"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
	"github.com/starquake/voidmarch/internal/world"
)

// derelictTicks is how long a derelict waits to be rescued, in hub ticks.
const derelictTicks = sim.DerelictLifetime * TickRate

// derelict is a ship to rescue into the hangar (#52): it drifts where it
// was released until a ship hovers beside it long enough, or its time is up.
// A held one waits, with no time running, until no enemy is near (#114).
type derelict struct {
	x, y, angle float64
	rescue      float64
	goneTick    uint32
	held        bool
	// spot is the map spot it waits at, from 1; 0 for none.
	spot int
	// frigateSpot is the Frigate spot it waits beside, from 1; 0 for none.
	frigateSpot int
}

// releaseDerelict puts a derelict at (x, y) and returns its id. It comes
// even with the fleet full: rescuing it then counts, but docks nothing.
func (h *Hub) releaseDerelict(x, y float64, spot int) uint32 {
	h.nextDerelict++
	h.derelicts[h.nextDerelict] = &derelict{
		x:        x,
		y:        y,
		angle:    h.rng.Float64() * fullTurnFloat,
		goneTick: h.tick + derelictTicks,
		spot:     spot,
	}

	return h.nextDerelict
}

// holdDerelict puts a held derelict at (x, y) and returns its id: its time
// starts once no enemy is near.
func (h *Hub) holdDerelict(x, y float64) uint32 {
	id := h.releaseDerelict(x, y, 0)
	d := h.derelicts[id]
	d.held, d.goneTick = true, math.MaxUint32

	return id
}

// fillDerelictSpots puts a derelict at every map spot without one.
func (h *Hub) fillDerelictSpots() {
	waiting := make(map[int]bool, len(h.derelicts))
	for _, d := range h.derelicts {
		waiting[d.spot] = true
	}
	for i, p := range h.derelictSpots {
		if !waiting[i+1] {
			h.releaseDerelict(p.x, p.y, i+1)
		}
	}
}

// derelictSpots are m's derelict spots; none without a map.
func derelictSpots(m *world.Map) []point {
	if m == nil {
		return nil
	}
	out := make([]point, 0, len(m.Derelicts))
	for _, s := range m.Derelicts {
		out = append(out, point{s.X, s.Y})
	}

	return out
}

// stepDerelicts fills or drains each derelict's rescue with the nearest ship
// that is up, docks the rescued and lets the expired go.
func (h *Hub) stepDerelicts() {
	h.fillDerelictSpots()
	if len(h.derelicts) == 0 {
		return
	}
	ships := h.upShips()
	for _, id := range slices.Sorted(maps.Keys(h.derelicts)) {
		d := h.derelicts[id]
		if h.tick >= d.goneTick {
			delete(h.derelicts, id)
			h.derelictDriftedOff(id)

			continue
		}
		if d.held && !h.free(id, d) {
			continue
		}
		helper, distance := nearestShip(point{d.x, d.y}, ships)
		var done bool
		d.rescue, done = sim.RescueStep(d.rescue, tickDuration, distance)
		if done {
			h.dockDerelict(id, helper)
			h.derelictRescued(id, point{d.x, d.y})
		}
	}
}

// free frees a held derelict once no enemy is within sim.DerelictHoldRadius,
// starting its time, and reports whether it's free.
func (h *Hub) free(id uint32, d *derelict) bool {
	for _, e := range h.enemies {
		if math.Hypot(e.x-d.x, e.y-d.y) < sim.DerelictHoldRadius {
			return false
		}
	}
	d.held, d.goneTick = false, h.tick+derelictTicks
	h.derelictFreed(id, d.goneTick)

	return true
}

// dockDerelict docks a rescued derelict in the hangar, if the fleet has
// room, and tells everyone who rescued it: a player, or the owner of the
// companion that did.
func (h *Hub) dockDerelict(id uint32, helper string) {
	delete(h.derelicts, id)
	docked := h.fleet() < sim.MaxFleet
	if docked {
		h.hangar++
	}
	player, _, _ := strings.Cut(helper, "/")
	h.broadcast(&pb.ServerMessage{Kind: &pb.ServerMessage_DerelictRescued{
		DerelictRescued: &pb.DerelictRescued{
			DerelictId: id,
			PlayerId:   player,
			Tick:       h.tick,
			Hangar:     uint32(max(h.hangar, 0)), //nolint:gosec // the hangar is small.
			Docked:     docked,
		},
	}}, "")
	h.broadcastSquadrons()
}

// nearestShip is the key of the ship nearest p and how far it is; infinitely
// far with none.
func nearestShip(p point, ships []upShip) (string, float64) {
	key, best := "", math.Inf(1)
	for _, s := range ships {
		if d := math.Hypot(s.at.x-p.x, s.at.y-p.y); d < best {
			key, best = s.key, d
		}
	}

	return key, best
}

// derelictPoints are where the derelicts free to rescue are, for the
// companions' brains.
func (h *Hub) derelictPoints() []sim.Vec {
	out := make([]sim.Vec, 0, len(h.derelicts))
	for _, id := range slices.Sorted(maps.Keys(h.derelicts)) {
		d := h.derelicts[id]
		if d.held {
			continue
		}
		out = append(out, sim.Vec{X: d.x, Y: d.y})
	}

	return out
}

func (h *Hub) derelictSnapshot() []*pb.DerelictState {
	out := make([]*pb.DerelictState, 0, len(h.derelicts))
	for _, id := range slices.Sorted(maps.Keys(h.derelicts)) {
		d := h.derelicts[id]
		out = append(out, &pb.DerelictState{
			DerelictId: id,
			X:          float32(d.x),
			Y:          float32(d.y),
			Angle:      float32(d.angle),
			Rescue:     float32(d.rescue),
			GoneTick:   d.goneTick,
			Held:       d.held,
		})
	}

	return out
}
