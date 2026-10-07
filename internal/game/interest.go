package game

import (
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// interestPoints are where m's interest in the enemies is measured from: its
// ship, or where it joined until its first state, and each of its
// companions (#231). A downed ship counts where it lies.
func interestPoints(m *member) []point {
	points := make([]point, 0, 1+len(m.wing.Companions))
	if m.state != nil {
		points = append(points, point{float64(m.state.GetX()), float64(m.state.GetY())})
	} else {
		points = append(points, m.from)
	}
	for _, c := range m.wing.Companions {
		points = append(points, point{c.Ship.X, c.Ship.Y})
	}

	return points
}

// nearEnemies are the enemies of all that m is sent, in all's order: every
// boss, and those within the interest radius of m's interest points, kept
// until they're past it by the margin. They become m's near set, so an enemy
// gone from the world drops out of it with the next snapshot.
func (h *Hub) nearEnemies(m *member, all []*pb.EnemyState) []*pb.EnemyState {
	points := interestPoints(m)
	enter := h.interestRadius * h.interestRadius
	leave := (h.interestRadius + sim.InterestMargin) * (h.interestRadius + sim.InterestMargin)
	near := make(map[uint32]bool, len(m.near))
	out := make([]*pb.EnemyState, 0, len(m.near))
	for _, e := range all {
		reach := enter
		if m.near[e.GetEnemyId()] {
			reach = leave
		}
		if boss(e.GetKind()) || within(points, float64(e.GetX()), float64(e.GetY()), reach) {
			near[e.GetEnemyId()] = true
			out = append(out, e)
		}
	}
	m.near = near

	return out
}

// sendNear sends msg to the members who were sent enemy id with the last
// snapshot: the clients that have it.
func (h *Hub) sendNear(id uint32, msg *pb.ServerMessage) {
	for memberID, m := range h.members {
		if m.near[id] {
			h.send(memberID, msg)
		}
	}
}

// boss reports whether kind is a boss, which every member is sent: the maps
// and the boss bar show them from afar.
func boss(kind pb.EnemyKind) bool {
	return kind == pb.EnemyKind_ENEMY_KIND_FRIGATE || kind == pb.EnemyKind_ENEMY_KIND_DREADNOUGHT
}

// within reports whether (x, y) is within the square root of squared of any
// of points.
func within(points []point, x, y, squared float64) bool {
	for _, p := range points {
		if dx, dy := p.x-x, p.y-y; dx*dx+dy*dy <= squared {
			return true
		}
	}

	return false
}
