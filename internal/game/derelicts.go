package game

import (
	"maps"
	"math"
	"slices"
	"strings"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// derelictTicks is how long a derelict waits to be rescued, in hub ticks.
const derelictTicks = sim.DerelictLifetime * TickRate

// derelict is a ship to rescue into the hangar (#52): it drifts where it
// was released until a ship hovers beside it long enough, or its time is up.
type derelict struct {
	x, y, angle float64
	rescue      float64
	goneTick    uint32
}

// releaseDerelict puts a derelict at (x, y), unless the fleet, counting the
// derelicts already waiting, is full: none is released that couldn't dock.
func (h *Hub) releaseDerelict(x, y float64) {
	if h.fleet()+len(h.derelicts) >= sim.MaxFleet {
		return
	}
	h.nextDerelict++
	h.derelicts[h.nextDerelict] = &derelict{
		x:        x,
		y:        y,
		angle:    h.rng.Float64() * fullTurnFloat,
		goneTick: h.tick + derelictTicks,
	}
}

// stepDerelicts fills or drains each derelict's rescue with the nearest ship
// that is up, docks the rescued and lets the expired go.
func (h *Hub) stepDerelicts() {
	if len(h.derelicts) == 0 {
		return
	}
	ships := h.upShips()
	for _, id := range slices.Sorted(maps.Keys(h.derelicts)) {
		d := h.derelicts[id]
		if h.tick >= d.goneTick {
			delete(h.derelicts, id)

			continue
		}
		helper, distance := nearestShip(point{d.x, d.y}, ships)
		var done bool
		d.rescue, done = sim.RescueStep(d.rescue, tickDuration, distance)
		if done {
			h.dockDerelict(id, helper)
		}
	}
}

// dockDerelict docks a rescued derelict in the hangar and tells everyone
// who rescued it: a player, or the owner of the companion that did.
func (h *Hub) dockDerelict(id uint32, helper string) {
	delete(h.derelicts, id)
	h.hangar++
	player, _, _ := strings.Cut(helper, "/")
	h.broadcast(&pb.ServerMessage{Kind: &pb.ServerMessage_DerelictRescued{
		DerelictRescued: &pb.DerelictRescued{
			DerelictId: id,
			PlayerId:   player,
			Tick:       h.tick,
			Hangar:     uint32(max(h.hangar, 0)), //nolint:gosec // the hangar is small.
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

// derelictPoints are where the derelicts are, for the companions' brains.
func (h *Hub) derelictPoints() []sim.Vec {
	out := make([]sim.Vec, 0, len(h.derelicts))
	for _, id := range slices.Sorted(maps.Keys(h.derelicts)) {
		d := h.derelicts[id]
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
		})
	}

	return out
}
