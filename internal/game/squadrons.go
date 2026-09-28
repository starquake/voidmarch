package game

import (
	"slices"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
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
	// mode is the squadron's standing orders for every companion in it.
	mode pb.CompanionMode
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

	out := &pb.Squadrons{NextName: h.nextSquadronName()}
	for _, sq := range list {
		info := &pb.SquadronInfo{Name: sq.name, Mode: sq.mode}
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
		sq = &squadron{name: next, mode: pb.CompanionMode_COMPANION_MODE_ESCORT}
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

	joined := &pb.SquadronJoined{Name: sq.name, Mode: sq.mode}
	if !slices.Contains(sq.members, id) {
		if h.squadronShips(sq) >= squadronCap {
			if owner, c := h.newestCompanionIn(sq); c != nil {
				joined.TookOver = true
				joined.X, joined.Y = c.state.GetX(), c.state.GetY()
				h.dismiss(owner, h.members[owner], c.number)
				takenOver := dismissed(c.number)
				takenOver.GetCompanionDismissed().TakenBy = m.session.Player.Name
				h.send(owner, takenOver)
			}
		}
		// The joiner's own companions come along as far as there's room.
		for len(m.companions) > 0 && h.squadronShips(sq)+1+len(m.companions) > squadronCap {
			newest := newestCompanionOf(m)
			h.dismiss(id, m, newest.number)
			h.send(id, dismissed(newest.number))
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

// squadronOrder passes a player's order to the rest of their squadron, and
// keeps a new mode as the squadron's.
func (h *Hub) squadronOrder(id string, m *member, order *pb.SquadronOrder) {
	sq := h.squadrons[m.squadron]
	if sq == nil {
		return
	}
	modeChanged := order.GetMode() != pb.CompanionMode_COMPANION_MODE_UNSPECIFIED &&
		order.GetMode() != sq.mode
	if modeChanged {
		sq.mode = order.GetMode()
	}
	ordered := &pb.ServerMessage{
		Kind: &pb.ServerMessage_SquadronOrdered{SquadronOrdered: &pb.SquadronOrdered{
			PlayerId: id,
			Name:     m.session.Player.Name,
			Order:    order,
		}},
	}
	for _, other := range sq.members {
		if other != id {
			h.send(other, ordered)
		}
	}
	if modeChanged {
		h.broadcastSquadrons()
	}
}
