package game

import (
	"cmp"
	"maps"
	"slices"
	"time"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/players"
)

// WithSeason starts the hub in the season saved: started then, and won at
// won, or the zero time while it isn't (#153, #156). A won season keeps the
// finale asleep, and every ring open, until a new one.
func WithSeason(started, won time.Time) HubOption {
	return func(o *hubOptions) {
		o.seasonStarted, o.seasonWonAt = started, won
	}
}

// WithSaveSeasonWon saves when the season was won, off the tick goroutine,
// when the finale falls (#153).
func WithSaveSeasonWon(save func(at time.Time)) HubOption {
	return func(o *hubOptions) {
		o.saveSeasonWon = save
	}
}

// WithStandings starts the hub with every player's season stats as saved,
// so the season's result has those who aren't online too (#156).
func WithStandings(standings []players.Standing) HubOption {
	return func(o *hubOptions) {
		o.standings = standings
	}
}

// WithClock sets the hub's clock, which times the season (#156).
func WithClock(now func() time.Time) HubOption {
	return func(o *hubOptions) {
		o.now = now
	}
}

// admit lets player join, counting their stats from what they joined with
// the first time, and gives a joiner of a won season its result (#156).
func (h *Hub) admit(player players.Player) joinResult {
	h.keepStats(player)
	h.names[player.ID] = player.Name
	res := h.handleJoin(player)
	if res.welcome != nil {
		res.welcome.Standings = h.standingsMessage()
		if h.seasonWon {
			res.welcome.SeasonWon = h.seasonResult(h.seasonWonAt)
		}
	}

	return res
}

// winSeason marks the season won now, saves it, and tells everyone its
// result (#153, #156).
func (h *Hub) winSeason() {
	at := h.now()
	h.seasonWon, h.seasonWonAt = true, at
	if h.saveSeasonWon != nil {
		h.saves <- func() { h.saveSeasonWon(at) }
	}
	h.broadcast(&pb.ServerMessage{Kind: &pb.ServerMessage_SeasonWon{
		SeasonWon: h.seasonResult(at),
	}}, "")
}

// devSeasonWon sends player the season's result as if it were won now, on a
// development server only, winning nothing (#156).
func (h *Hub) devSeasonWon(player string) {
	if !h.development {
		return
	}
	h.send(player, &pb.ServerMessage{Kind: &pb.ServerMessage_SeasonWon{
		SeasonWon: h.seasonResult(h.now()),
	}})
}

// seasonResult is the season's result, won at: how long it took, and
// everyone who did anything, most kills first.
func (h *Hub) seasonResult(at time.Time) *pb.SeasonWon {
	return &pb.SeasonWon{
		Season:  h.seasonStarted.Unix(),
		Seconds: uint64(max(0, at.Sub(h.seasonStarted).Seconds())),
		Players: h.standingRows(),
		Sectors: uint32(len(h.cleared)), //nolint:gosec // 37 sectors at most.
	}
}

// standingRows are everyone who did anything this season, most kills first.
func (h *Hub) standingRows() []*pb.PlayerStats {
	var rows []*pb.PlayerStats
	for _, id := range slices.Sorted(maps.Keys(h.stats)) {
		if s := *h.stats[id]; s != (players.Stats{}) {
			rows = append(rows, pbPlayerStats(id, h.names[id], s))
		}
	}
	slices.SortStableFunc(rows, func(a, b *pb.PlayerStats) int {
		return cmp.Compare(b.GetKills(), a.GetKills())
	})

	return rows
}

// standingsMessage is the season so far, for the join screen and the down
// panel (#167).
func (h *Hub) standingsMessage() *pb.Standings {
	return &pb.Standings{Players: h.standingRows(), Season: h.seasonStarted.Unix()}
}

// pbPlayerStats is a player's stats on the wire.
func pbPlayerStats(id, name string, s players.Stats) *pb.PlayerStats {
	n := func(v int) uint32 { return uint32(max(0, v)) } //nolint:gosec // counts.

	return &pb.PlayerStats{
		PlayerId:       id,
		Name:           name,
		Kills:          n(s.Kills),
		CompanionKills: n(s.CompanionKills),
		Shots:          n(s.Shots),
		Hits:           n(s.Hits),
		Deaths:         n(s.Deaths),
		Rescues:        n(s.Rescues),
		Sectors:        n(s.Sectors),
	}
}
