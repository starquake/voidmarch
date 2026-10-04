package game

import (
	"maps"
	"slices"
	"strings"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/players"
	"github.com/starquake/voidmarch/internal/sim"
)

// statsSaveEvery is how often the season stats that changed are saved.
const statsSaveEvery = 10 * TickRate

// WithSaveStats saves a player's season stats, off the tick goroutine, every
// statsSaveEvery ticks while they change, when the player leaves, and when
// the hub stops (#154).
func WithSaveStats(save func(player string, s players.Stats)) HubOption {
	return func(o *hubOptions) {
		o.saveStats = save
	}
}

// keepStats starts counting player's stats from what they joined with, the
// first time they join; the hub's count is the newest after that.
func (h *Hub) keepStats(player players.Player) {
	if _, ok := h.stats[player.ID]; !ok {
		s := player.Stats
		h.stats[player.ID] = &s
	}
}

// countStat counts something player did, if they're a player the hub knows.
func (h *Hub) countStat(player string, count func(*players.Stats)) {
	if s, ok := h.stats[player]; ok {
		count(s)
		h.statsChanged[player] = true
		h.standingsChanged = true
	}
}

// countKill counts a kill for shooter: their own ship's, or, for a
// companion's seat, a companion kill for its owner.
func (h *Hub) countKill(shooter string) {
	if owner, _, companion := strings.Cut(shooter, "/"); companion {
		h.countStat(owner, func(s *players.Stats) { s.CompanionKills++ })

		return
	}
	h.countStat(shooter, func(s *players.Stats) { s.Kills++ })
}

// countHit counts player's shot hitting once, however many enemies a
// piercing shot goes through; a ram (shot 0) and a burst's shards aren't
// shots fired.
func (h *Hub) countHit(player string, m *member, shot shotHit) {
	if shot.id == 0 || shot.shard != 0 || shot.id == m.lastHitShot {
		return
	}
	m.lastHitShot = shot.id
	h.countStat(player, func(s *players.Stats) { s.Hits++ })
}

// countClear counts s cleared for every player in it.
func (h *Hub) countClear(s sim.Sector) {
	for id, m := range h.members {
		if m.gone || m.state == nil {
			continue
		}
		if in, ok := sim.SectorAt(float64(m.state.GetX()), float64(m.state.GetY())); ok && in == s {
			h.countStat(id, func(st *players.Stats) { st.Sectors++ })
		}
	}
}

// saveStatsOf saves player's stats if they changed since the last save.
func (h *Hub) saveStatsOf(player string) {
	if !h.statsChanged[player] || h.saveStats == nil {
		return
	}
	delete(h.statsChanged, player)
	s := *h.stats[player]
	h.saves <- func() { h.saveStats(player, s) }
}

// saveChangedStats saves every player's stats that changed.
func (h *Hub) saveChangedStats() {
	for _, id := range slices.Sorted(maps.Keys(h.statsChanged)) {
		h.saveStatsOf(id)
	}
}

// noteBaseline keeps player's stats as they are, the first time they're in
// g's sector, so its clear can tell what they did there; a companion's seat
// isn't a player (#167).
func (h *Hub) noteBaseline(g *garrison, player string) {
	if strings.Contains(player, "/") {
		return
	}
	if g.baselines == nil {
		g.baselines = make(map[string]players.Stats)
	}
	if _, noted := g.baselines[player]; noted {
		return
	}
	if s, ok := h.stats[player]; ok {
		g.baselines[player] = *s
	}
}

// missionStats is what each player who fought in g's sector did there: their
// kills, companion kills, shots, hits and deaths since they first came in.
func (h *Hub) missionStats(g *garrison) []*pb.PlayerStats {
	out := make([]*pb.PlayerStats, 0, len(g.baselines))
	for _, id := range slices.Sorted(maps.Keys(g.baselines)) {
		now, ok := h.stats[id]
		if !ok {
			continue
		}
		then := g.baselines[id]
		out = append(out, pbPlayerStats(id, h.names[id], players.Stats{
			Kills:          now.Kills - then.Kills,
			CompanionKills: now.CompanionKills - then.CompanionKills,
			Shots:          now.Shots - then.Shots,
			Hits:           now.Hits - then.Hits,
			Deaths:         now.Deaths - then.Deaths,
		}))
	}

	return out
}

// sendStandingsIfChanged tells everyone the season so far, when any stat
// changed since the last time (#167).
func (h *Hub) sendStandingsIfChanged() {
	if !h.standingsChanged {
		return
	}
	h.standingsChanged = false
	h.broadcast(
		&pb.ServerMessage{Kind: &pb.ServerMessage_Standings{Standings: h.standingsMessage()}},
		"",
	)
}
