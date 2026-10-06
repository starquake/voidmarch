package game_test

import (
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
)

// blindHullHits is the hull steps the seeded fight in
// TestCompanions_DodgeTheHubsBullets took off the companion before
// companions dodged (#249).
const blindHullHits = 10

// hullHits flies a's stealthy companion out with a, parked at (0, 1000) in
// D5's garrison, for seconds, and counts the hull steps enemy fire takes off
// it.
func hullHits(t *testing.T, a *Session, tick func(int), seconds int) int {
	t.Helper()

	a.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_SquadronOrder{SquadronOrder: &pb.SquadronOrder{
		Mode: pb.CompanionMode_COMPANION_MODE_STEALTH,
	}}})
	hits, last := 0, uint32(0)
	for range seconds * TickRate {
		c := companion(must(latest(t, a, tick, 1, 0, 1000)))
		if c == nil {
			continue
		}
		if damage := c.GetDamage(); damage > last {
			hits += int(damage - last)
		}
		last = c.GetDamage()
	}

	return hits
}

func TestCompanions_DodgeTheHubsBullets(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	grant(t, a)
	if got := hullHits(t, a, tick, 60); got > blindHullHits/2 {
		t.Errorf(
			"a/1 took %d hull hits in a minute under fire, want at most half the %d it took before it dodged",
			got,
			blindHullHits,
		)
	}
}
