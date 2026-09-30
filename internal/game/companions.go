package game

import (
	"maps"
	"math"
	"slices"
	"strconv"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// Companion rules (docs/design.md, section 13).
const (
	// companionLimit is how many companions a player may have at once.
	companionLimit = 3

	decimal = 10
)

// companion is a seat the hub flies with an AI brain (flight.go).
type companion struct {
	number uint32
	// granted orders companions by age, so the newest is displaced first.
	granted uint64
	flight  *sim.Companion
}

// seatID names a companion's seat: "<owner>/<n>".
func seatID(owner string, number uint32) string {
	return owner + "/" + strconv.FormatUint(uint64(number), decimal)
}

// seats counts the humans and companions in the world; a player who
// dropped holds no seat, though their companions flying home do.
func (h *Hub) seats() int {
	n := 0
	for _, m := range h.members {
		if !m.gone {
			n++
		}
		n += len(m.companions)
	}

	return n
}

// summon grants the owner a companion, or says why not.
func (h *Hub) summon(owner string, m *member) {
	if reason := h.summonRefusal(m); reason != "" {
		h.send(owner, &pb.ServerMessage{Kind: &pb.ServerMessage_CompanionRefused{
			CompanionRefused: &pb.CompanionRefused{Reason: reason},
		}})

		return
	}
	number := uint32(1)
	for m.companions[number] != nil {
		number++
	}
	h.nextGrant++
	h.hangar--
	// Picked before it joins the wing, whose loadouts it would otherwise count.
	loadout := sim.CompanionLoadout(m.unlocks, h.squadronLoadouts(owner, m))
	flight := m.wing.Add(
		int(number),
		float64(m.state.GetX()),
		float64(m.state.GetY()),
		h.squadronModeOrders(m),
	)
	flight.Fit(loadout)
	m.companions[number] = &companion{number: number, granted: h.nextGrant, flight: flight}
	h.broadcastSquadrons()
	h.send(owner, &pb.ServerMessage{Kind: &pb.ServerMessage_CompanionGranted{
		CompanionGranted: &pb.CompanionGranted{
			Companion: number,
			X:         m.state.GetX(),
			Y:         m.state.GetY(),
		},
	}})
}

// squadronLoadouts are the loadouts of every ship in owner's squadron: its
// players and their companions, or just the owner's own without one.
func (h *Hub) squadronLoadouts(owner string, m *member) []sim.Loadout {
	var out []sim.Loadout
	for _, id := range append([]string{owner}, h.squadmates(owner, m)...) {
		mate := h.members[id]
		if mate.state != nil {
			out = append(out, simLoadout(mate.state.GetLoadout()))
		}
		for _, c := range mate.wing.Companions {
			out = append(out, c.Ship.Loadout)
		}
	}

	return out
}

// summonRefusal is why the owner can't have another companion, or "".
func (h *Hub) summonRefusal(m *member) string {
	switch {
	case len(m.companions) >= companionLimit:
		return "all your companions are already out"
	case h.seats() >= MaxPlayers:
		return "the frontier is full"
	case m.state == nil ||
		math.Hypot(float64(m.state.GetX()), float64(m.state.GetY())) > safeRadius:
		return "summon companions at the home planet"
	case h.hangar <= 0:
		return "the hangar is empty"
	case h.squadrons[m.squadron] == nil:
		return "pick a squadron first"
	case h.squadronShips(h.squadrons[m.squadron]) >= squadronCap:
		return "your squadron is full"
	}

	return ""
}

// dismiss sends a companion home: its seat is given back, its ship docks in
// the hangar, and everyone else is told it's gone.
func (h *Hub) dismiss(owner string, m *member, number uint32) {
	if !h.takeCompanion(owner, m, number) {
		return
	}
	h.hangar++
	h.broadcastSquadrons()
}

// takeCompanion removes a companion from the world without docking its ship,
// for a joiner taking its place, and reports whether there was one.
func (h *Hub) takeCompanion(owner string, m *member, number uint32) bool {
	if m == nil {
		return false
	}
	if _, ok := m.companions[number]; !ok {
		return false
	}
	delete(m.companions, number)
	m.wing.Remove(int(number))
	h.broadcast(left(seatID(owner, number)), owner)

	return true
}

// sendLostCompanionsHome docks every companion down for
// sim.CompanionLostSeconds unrevived in the hangar, and tells its owner.
func (h *Hub) sendLostCompanionsHome() {
	for _, owner := range slices.Sorted(maps.Keys(h.members)) {
		m := h.members[owner]
		for _, number := range slices.Sorted(maps.Keys(m.companions)) {
			if m.companions[number].flight.Ship.DownFor >= sim.CompanionLostSeconds {
				h.dismiss(owner, m, number)
				h.send(owner, dismissed(number))
			}
		}
	}
}

// displaceNewestCompanion frees a seat for a joining human: the newest
// companion in the world goes, held for the joiner rather than docked, and
// its owner is told. It reports whether one was found.
func (h *Hub) displaceNewestCompanion() bool {
	var owner string
	var newest *companion
	for id, m := range h.members {
		for _, c := range m.companions {
			if newest == nil || c.granted > newest.granted {
				owner, newest = id, c
			}
		}
	}
	if newest == nil {
		return false
	}
	// Free the seat before telling the owner: the send may drop them as too slow.
	h.takeCompanion(owner, h.members[owner], newest.number)
	h.broadcastSquadrons()
	h.send(owner, dismissed(newest.number))

	return true
}

// companionSnapshots are every companion, their owners' included: the hub
// flies them all.
func (h *Hub) companionSnapshots() []*pb.PlayerSnapshot {
	var out []*pb.PlayerSnapshot
	for _, owner := range slices.Sorted(maps.Keys(h.members)) {
		m := h.members[owner]
		for _, number := range slices.Sorted(maps.Keys(m.companions)) {
			out = append(out, &pb.PlayerSnapshot{
				PlayerId: seatID(owner, number),
				Name:     m.session.Player.Name,
				Color:    m.color,
				State:    companionState(m.companions[number].flight),
				OwnerId:  owner,
				Squadron: m.squadron,
			})
		}
	}

	return out
}

func dismissed(number uint32) *pb.ServerMessage {
	return &pb.ServerMessage{Kind: &pb.ServerMessage_CompanionDismissed{
		CompanionDismissed: &pb.CompanionDismissed{Companion: number},
	}}
}

func left(id string) *pb.ServerMessage {
	return &pb.ServerMessage{Kind: &pb.ServerMessage_Left{Left: &pb.PlayerLeft{PlayerId: id}}}
}
