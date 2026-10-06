package game_test

import (
	"slices"
	"testing"
	"time"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/players"
	"github.com/starquake/voidmarch/internal/sim"
)

// seasonStart is when the seasons in these tests started.
var seasonStart = time.Unix(1_800_000_000, 0)

func TestSeason_TheFinalesFallTellsEveryoneTheResult(t *testing.T) {
	t.Parallel()

	took := 41*time.Hour + 12*time.Minute
	hub, tick := testHub(
		t,
		WithOpenRings(3),
		WithClearedSectors(finaleCleared()),
		WithDreadnought(sim.Nautolan, 0.0005),
		WithSeason(seasonStart, time.Time{}),
		WithClock(func() time.Time { return seasonStart.Add(took) }),
		WithStandings([]players.Standing{
			{ID: "z", Name: "Zed", Stats: players.Stats{Kills: 9, Shots: 30}},
			{ID: "idle", Name: "Idle"},
		}),
		WithPoolStart(3),
		NoEvents,
	)
	a, _ := join(t, hub, "a")
	d := dreadnoughtIn(must(latest(t, a, tick, 2, 0, 0)))
	if d == nil {
		t.Fatal("no Nautolan Dreadnought awake")
	}
	x, y := d.GetX(), d.GetY()+300
	must(latest(t, a, tick, 1, x, y))
	for shot := range uint32(sim.DreadnoughtShield/MaxHitDamage + 2) { //nolint:gosec // a few shots.
		hitFrigate(a, d.GetEnemyId(), shot+1)
	}
	var won *pb.SeasonWon
	for _, msg := range must2(latest(t, a, tick, 1, x, y)) {
		if w := msg.GetSeasonWon(); w != nil {
			won = w
		}
	}
	if won == nil {
		t.Fatal("no SeasonWon when the finale fell")
	}
	if won.GetSeason() != seasonStart.Unix() || won.GetSeconds() != uint64(took.Seconds()) {
		t.Errorf(
			"SeasonWon season %d, %d s, want %d, %v",
			won.GetSeason(),
			won.GetSeconds(),
			seasonStart.Unix(),
			took,
		)
	}
	// The finale's fall clears its own sector first (#223).
	want := uint32(len(finaleCleared()))
	if !slices.Contains(finaleCleared(), dreadnoughtSector(t, d).Name()) {
		want++
	}
	if got := won.GetSectors(); got != want {
		t.Errorf("SeasonWon sectors = %d, want %d, its own sector included", got, want)
	}
	rows := won.GetPlayers()
	if len(rows) != 2 || rows[0].GetName() != "Zed" || rows[0].GetKills() != 9 ||
		rows[1].GetPlayerId() != "a" || rows[1].GetKills() != 1 {
		t.Errorf("SeasonWon players = %v, want Zed's 9 kills, then a's 1, and nobody idle", rows)
	}
}

func TestSeason_AJoinerOfAWonSeasonIsToldItsResult(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(
		t,
		WithSeason(seasonStart, seasonStart.Add(30*time.Hour)),
		WithStandings([]players.Standing{{ID: "z", Name: "Zed", Stats: players.Stats{Kills: 2}}}),
	)
	_, w := join(t, hub, "a")
	if got := w.GetSeasonWon(); got.GetSeconds() != 30*60*60 || len(got.GetPlayers()) != 1 {
		t.Errorf("Welcome.SeasonWon = %v, want 30 h, with Zed", got)
	}
	unwon, _ := testHub(t, WithSeason(seasonStart, time.Time{}))
	if _, w := join(t, unwon, "a"); w.GetSeasonWon() != nil {
		t.Errorf("Welcome.SeasonWon = %v before the season is won, want none", w.GetSeasonWon())
	}
}

func TestSeason_DevSeasonWonGoesToTheAskerOnADevelopmentServer(t *testing.T) {
	t.Parallel()

	ask := &pb.ClientMessage{Kind: &pb.ClientMessage_DevSeasonWon{DevSeasonWon: &pb.DevSeasonWon{}}}
	for _, development := range []bool{true, false} {
		opts := []HubOption{WithSeason(seasonStart, time.Time{})}
		if development {
			opts = append(opts, WithDevelopment())
		}
		hub, tick := testHub(t, opts...)
		a, _ := join(t, hub, "a")
		b, _ := join(t, hub, "b")
		a.Send(ask)
		got := func(s *Session) bool {
			for _, msg := range must2(latest(t, s, tick, 1, 0, 0)) {
				if msg.GetSeasonWon() != nil {
					return true
				}
			}

			return false
		}
		if a, b := got(a), got(b); a != development || b {
			t.Errorf(
				"development %t: the asker got SeasonWon %t, the other %t; want %t and false",
				development,
				a,
				b,
				development,
			)
		}
		if d := dreadnoughtIn(must(latest(t, a, tick, 1, 0, 0))); d != nil {
			t.Errorf("Dreadnought %+v after asking, want the season left as it was", d)
		}
	}
}
