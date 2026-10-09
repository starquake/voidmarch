package game_test

import (
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
)

// blindHullHits is the hull steps the seeded fight in
// TestCompanions_DodgeTheHubsBullets took off the companion before
// companions dodged (#249).
const blindHullHits = 10

// hullHits flies a's companion out with a, parked at (0, 1000) in D5's
// garrison, for seconds, and counts the hull steps enemy fire takes off it.
// The hub must hold the companions' fire, so the garrison keeps shooting.
func hullHits(t *testing.T, a *Session, tick func(int), seconds int) int {
	t.Helper()

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

	hub, tick := testHub(t, WithCompanionsHoldingFire())
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
