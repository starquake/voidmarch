package game_test

import (
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	"github.com/starquake/voidmarch/internal/sim"
)

func TestVolleyRange_InsideInterest(t *testing.T) {
	t.Parallel()

	// A volley the hub flies for a companion comes from an enemy its owner is sent.
	if got, limit := VolleyRange+WarningTravel(), float64(sim.InterestRadius); got >= limit {
		t.Errorf(
			"VolleyRange + WarningTravel() = %v, should stay under sim.InterestRadius %v",
			got,
			limit,
		)
	}
}
