package game

import (
	"slices"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// squadronCap is the most ships in a squadron, companions included
// (docs/design.md, section 13).
const squadronCap = 4

// squadronNames are handed out in order: a new squadron gets the first free.
func squadronNames() []string {
	return []string{
		"Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta",
		"Iota", "Kappa", "Lambda", "Mu", "Nu", "Xi", "Omicron", "Pi",
		"Rho", "Sigma", "Tau", "Upsilon", "Phi", "Chi", "Psi", "Omega",
	}
}

// squadron is a group of up to squadronCap ships flying together.
type squadron struct {
	name string
	// members are player ids, in the order they joined.
	members []string
	// mission is the sector it's sent to, while hasMission (#101).
	mission    sim.Sector
	hasMission bool
}

// nextSquadronName is the first free name, or "" when all are taken.
func (h *Hub) nextSquadronName() string {
	for _, name := range squadronNames() {
		if h.squadrons[name] == nil {
			return name
		}
	}

	return ""
}

// squadronShips counts a squadron's players and their companions.
func (h *Hub) squadronShips(sq *squadron) int {
	n := 0
	for _, id := range sq.members {
		n++
		if m := h.members[id]; m != nil {
			n += len(m.companions)
		}
	}

	return n
}

// squadronsMessage lists every squadron, the most players first, so a
// joining player sees where people are.
func (h *Hub) squadronsMessage() *pb.Squadrons {
	list := make([]*squadron, 0, len(h.squadrons))
	for _, name := range squadronNames() {
		if sq := h.squadrons[name]; sq != nil {
			list = append(list, sq)
		}
	}
	slices.SortStableFunc(list, func(a, b *squadron) int { return len(b.members) - len(a.members) })

	out := &pb.Squadrons{
		NextName: h.nextSquadronName(),
		Hangar:   uint32(max(h.hangar, 0)), //nolint:gosec // never negative.
	}
	for _, sq := range list {
		info := &pb.SquadronInfo{Name: sq.name}
		if sq.hasMission {
			info.Mission = sq.mission.Name()
		}
		for _, id := range sq.members {
			m := h.members[id]
			if m == nil {
				continue
			}
			info.Members = append(info.Members, &pb.SquadronMember{
				PlayerId:   id,
				Name:       m.session.Player.Name,
				Companions: uint32(len(m.companions)), //nolint:gosec // at most MaxPlayers.
			})
		}
		out.Squadrons = append(out.Squadrons, info)
	}

	return out
}

// broadcastSquadrons tells everyone the squadrons changed.
func (h *Hub) broadcastSquadrons() {
	h.broadcast(
		&pb.ServerMessage{Kind: &pb.ServerMessage_Squadrons{Squadrons: h.squadronsMessage()}},
		"",
	)
}

// chooseSquadron moves a player into the named squadron, or into a new one
// when the name is empty. A squadron at its cap makes room by giving the
// joiner its newest companion's seat, and place.
func (h *Hub) chooseSquadron(id string, m *member, name string) {
	refuse := func(reason string) {
		h.send(id, &pb.ServerMessage{Kind: &pb.ServerMessage_SquadronRefused{
			SquadronRefused: &pb.SquadronRefused{Reason: reason},
		}})
	}
	var sq *squadron
	switch name {
	case "":
		next := h.nextSquadronName()
		if next == "" {
			refuse("no squadron names are left")

			return
		}
		h.leaveSquadron(id, m)
		sq = &squadron{name: next}
		sq.mission, sq.hasMission = sim.MissionFor(h.cleared, h.frontier, shipAt(m))
		h.squadrons[next] = sq
	case m.squadron:
		sq = h.squadrons[name]
	default:
		sq = h.squadrons[name]
		if sq == nil {
			refuse(name + " is gone")

			return
		}
		if len(sq.members) >= squadronCap {
			refuse(name + " is full")

			return
		}
		h.leaveSquadron(id, m)
	}

	joined := &pb.SquadronJoined{Name: sq.name}
	if !slices.Contains(sq.members, id) {
		if h.squadronShips(sq) >= squadronCap {
			if owner, c := h.newestCompanionIn(sq); c != nil {
				joined.TookOver = true
				joined.X, joined.Y = float32(c.flight.Ship.X), float32(c.flight.Ship.Y)
				h.takeCompanion(owner, h.members[owner], c.number)
				m.held++
				takenOver := dismissed(c.number)
				takenOver.GetCompanionDismissed().TakenBy = m.session.Player.Name
				h.send(owner, takenOver)
			}
		}
		// The joiner's own companions come along as far as there's room.
		for len(m.companions) > 0 && h.squadronShips(sq)+1+len(m.companions) > squadronCap {
			h.dockCompanion(id, m, nextToDock(m).number)
		}
		sq.members = append(sq.members, id)
		m.squadron = sq.name
	}
	h.send(id, &pb.ServerMessage{Kind: &pb.ServerMessage_SquadronJoined{SquadronJoined: joined}})
	h.broadcastSquadrons()
}

// leaveSquadron takes a player out of their squadron; an emptied squadron
// goes, freeing its name.
func (h *Hub) leaveSquadron(id string, m *member) {
	sq := h.squadrons[m.squadron]
	m.squadron = ""
	if sq == nil {
		return
	}
	sq.members = slices.DeleteFunc(sq.members, func(other string) bool { return other == id })
	if len(sq.members) == 0 {
		delete(h.squadrons, sq.name)
	}
}

// newestCompanionIn is the squadron's most recently granted companion and
// its owner, or nil.
func (h *Hub) newestCompanionIn(sq *squadron) (string, *companion) {
	var owner string
	var newest *companion
	for _, id := range sq.members {
		m := h.members[id]
		if m == nil {
			continue
		}
		if c := newestCompanionOf(m); c != nil && (newest == nil || c.granted > newest.granted) {
			owner, newest = id, c
		}
	}

	return owner, newest
}

func newestCompanionOf(m *member) *companion {
	var newest *companion
	for _, c := range m.companions {
		if newest == nil || c.granted > newest.granted {
			newest = c
		}
	}

	return newest
}

// nextToDock is the companion of m's to dock first when there's too little
// room: the newest that is down, so the ones that can fly come along, else
// the newest.
func nextToDock(m *member) *companion {
	var newest *companion
	for _, c := range m.companions {
		if !c.flight.Ship.Downed() {
			continue
		}
		if newest == nil || c.granted > newest.granted {
			newest = c
		}
	}
	if newest == nil {
		return newestCompanionOf(m)
	}

	return newest
}
