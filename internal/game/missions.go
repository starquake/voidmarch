package game

import (
	"maps"
	"slices"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// shipAt is where m's ship is, or home before it has a state.
func shipAt(m *member) sim.Vec {
	if m == nil || m.state == nil {
		return sim.Vec{}
	}

	return sim.Vec{X: float64(m.state.GetX()), Y: float64(m.state.GetY())}
}

// pickMission sends m's squadron to the named sector, if it's on the grid,
// not home and not cleared (#101).
func (h *Hub) pickMission(m *member, name string) {
	sq := h.squadrons[m.squadron]
	s, ok := sim.ParseSector(name)
	if sq == nil || !ok || s == sim.HomeSector() || h.cleared[s] {
		return
	}
	sq.mission, sq.hasMission = s, true
	h.broadcastSquadrons()
}

// moveMissionsOn gives every squadron sent to s, now cleared, its next
// default mission, near its first member.
func (h *Hub) moveMissionsOn(s sim.Sector) {
	for _, name := range slices.Sorted(maps.Keys(h.squadrons)) {
		sq := h.squadrons[name]
		if !sq.hasMission || sq.mission != s {
			continue
		}
		var first *member
		if len(sq.members) > 0 {
			first = h.members[sq.members[0]]
		}
		sq.mission, sq.hasMission = sim.MissionFor(h.cleared, shipAt(first))
	}
}

// rewardClear adds a ship to the hangar, within the fleet cap, and grants
// every player online a part they can use (#101, decisions 5 and 7). It
// returns what each gained.
func (h *Hub) rewardClear() []*pb.PickupGain {
	if h.fleet() < sim.MaxFleet {
		h.hangar++
	}
	var gains []*pb.PickupGain
	for _, id := range slices.Sorted(maps.Keys(h.members)) {
		m := h.members[id]
		if m.gone {
			continue
		}
		part, ok := sim.DropFor([]sim.Unlocks{m.unlocks}, nil, 1, h.rng.Uint32())
		if !ok || !m.unlocks.Grant(part) {
			continue
		}
		tier := m.unlocks[part]
		gains = append(gains, &pb.PickupGain{
			PlayerId: id,
			Unlock:   &pb.Unlock{Part: pbPart(part), Tier: wireTier(tier)},
		})
		if h.saveUnlock != nil {
			who := id
			h.saves <- func() { h.saveUnlock(who, part, tier) }
		}
	}

	return gains
}
