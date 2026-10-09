package game

import (
	"hash/fnv"
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
	// Its owner too: their client draws it like any other ship (#129).
	h.broadcast(left(seatID(owner, number)), "")

	return true
}

// dockCompanion sends a companion home to the hangar, as dismiss does, and
// tells its owner, who didn't ask for it.
func (h *Hub) dockCompanion(owner string, m *member, number uint32) {
	h.dismiss(owner, m, number)
	h.send(owner, dismissed(number))
}

// dockDownedCompanions docks the owner's downed companions as they respawn
// at home, but for any with an up squadmate near enough to revive it.
func (h *Hub) dockDownedCompanions(owner string, m *member) {
	for _, number := range slices.Sorted(maps.Keys(m.companions)) {
		s := m.companions[number].flight.Ship
		if s.Downed() && !h.upSquadmateNear(owner, m, s.X, s.Y) {
			h.dockCompanion(owner, m, number)
		}
	}
}

// upSquadmateNear reports whether a ship up in the owner's squadron may
// revive a companion downed at (x, y): another player within
// sim.CompanionWaitRadius, who can choose to fly over, or a companion, the
// owner's or a squadmate's, that sim.ComesToRevive. The owner's own ship
// doesn't count.
func (h *Hub) upSquadmateNear(owner string, m *member, x, y float64) bool {
	comes := func(mate *member) bool {
		for _, c := range mate.wing.Companions {
			if sim.ComesToRevive(c.Ship, x, y) {
				return true
			}
		}

		return false
	}
	if comes(m) {
		return true
	}
	for _, id := range h.squadmates(owner, m) {
		mate := h.members[id]
		if s := mate.state; s != nil && !downed(s) &&
			math.Hypot(float64(s.GetX())-x, float64(s.GetY())-y) <= sim.CompanionWaitRadius {
			return true
		}
		if comes(mate) {
			return true
		}
	}

	return false
}

// sendLostCompanionsHome docks every companion down for
// sim.CompanionLostSeconds unrevived in the hangar, and tells its owner.
func (h *Hub) sendLostCompanionsHome() {
	for _, owner := range slices.Sorted(maps.Keys(h.members)) {
		m := h.members[owner]
		for _, number := range slices.Sorted(maps.Keys(m.companions)) {
			if m.companions[number].flight.Ship.DownFor >= sim.CompanionLostSeconds {
				h.dockCompanion(owner, m, number)
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

// wingKey is a player's companions' key for spreading over the enemies:
// the same for every join of theirs, and different from other players'
// (#165).
func wingKey(player string) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(player))

	return h.Sum32()
}
