package game

import (
	"maps"
	"math"
	"slices"
	"strconv"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
)

// Companion rules (docs/design.md, section 13).
const (
	// companionLimit is how many companions a player may have at once.
	companionLimit = 3

	decimal = 10
)

// companion is a seat its owner's client flies with an AI brain.
type companion struct {
	number uint32
	state  *pb.ShipState
	// granted orders companions by age, so the newest is displaced first.
	granted uint64
	// lastSeen is the tick of its last state, or of its grant.
	lastSeen uint32
}

// seatID names a companion's seat: "<owner>/<n>".
func seatID(owner string, number uint32) string {
	return owner + "/" + strconv.FormatUint(uint64(number), decimal)
}

// shooterID is who fired: the player, or their companion's seat. A
// companion the server hasn't granted fires nothing.
func shooterID(owner string, m *member, companion uint32) (string, bool) {
	if companion == 0 {
		return owner, true
	}
	if _, ok := m.companions[companion]; !ok {
		return "", false
	}

	return seatID(owner, companion), true
}

// seats counts the humans and companions in the world.
func (h *Hub) seats() int {
	n := len(h.members)
	for _, m := range h.members {
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
	m.companions[number] = &companion{number: number, granted: h.nextGrant, lastSeen: h.tick}
	h.broadcastSquadrons()
	h.send(owner, &pb.ServerMessage{Kind: &pb.ServerMessage_CompanionGranted{
		CompanionGranted: &pb.CompanionGranted{
			Companion: number,
			X:         m.state.GetX(),
			Y:         m.state.GetY(),
		},
	}})
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

// companionState updates a companion's ship. A state for a companion the
// server doesn't know (lost when the player dropped) dismisses it, so the
// client stops flying a seat nobody else can see.
func (h *Hub) companionState(owner string, m *member, msg *pb.CompanionState) {
	c, ok := m.companions[msg.GetCompanion()]
	if !ok {
		h.send(owner, dismissed(msg.GetCompanion()))

		return
	}
	c.state = msg.GetState()
	c.lastSeen = h.tick
}

// expireCompanions gives back the seats of companions whose states stopped,
// like a silent player's: a client that no longer flies them (a closed tab,
// a lost grant) would otherwise hold them forever.
func (h *Hub) expireCompanions() {
	for _, owner := range slices.Sorted(maps.Keys(h.members)) {
		m, ok := h.members[owner]
		if !ok {
			continue
		}
		for _, number := range slices.Sorted(maps.Keys(m.companions)) {
			if h.tick-m.companions[number].lastSeen > silenceTicks {
				h.dismiss(owner, m, number)
				h.send(owner, dismissed(number))
			}
		}
	}
}

// dismiss gives a companion's seat back, and tells everyone else it's gone.
func (h *Hub) dismiss(owner string, m *member, number uint32) {
	if m == nil {
		return
	}
	if _, ok := m.companions[number]; !ok {
		return
	}
	delete(m.companions, number)
	h.hangar++
	h.broadcast(left(seatID(owner, number)), owner)
	h.broadcastSquadrons()
}

// displaceNewestCompanion frees a seat for a joining human: the newest
// companion in the world goes, and its owner is told. It reports whether one
// was found.
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
	h.dismiss(owner, h.members[owner], newest.number)
	h.send(owner, dismissed(newest.number))

	return true
}

// companionSnapshots are every companion not owned by viewer, as players.
func (h *Hub) companionSnapshots(viewer string) []*pb.PlayerSnapshot {
	var out []*pb.PlayerSnapshot
	for _, owner := range slices.Sorted(maps.Keys(h.members)) {
		m := h.members[owner]
		if owner == viewer {
			continue
		}
		for _, number := range slices.Sorted(maps.Keys(m.companions)) {
			c := m.companions[number]
			if c.state == nil {
				continue
			}
			out = append(out, &pb.PlayerSnapshot{
				PlayerId: seatID(owner, number),
				Name:     m.session.Player.Name,
				Colour:   m.colour,
				State:    c.state,
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
