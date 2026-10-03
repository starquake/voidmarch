package game

import (
	"maps"
	"slices"
	"strings"

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
