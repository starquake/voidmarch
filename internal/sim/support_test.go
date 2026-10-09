package sim_test

import (
	"slices"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

func TestEnemyPattern_ASupportShipHasNoGuns(t *testing.T) {
	t.Parallel()

	for _, faction := range EnemyFactions() {
		if got := EnemyPattern(EnemySupport, faction, 0, 0, 0, 1); len(got) != 0 {
			t.Errorf("EnemyPattern(support, %s) = %d bullets, want none", faction, len(got))
		}
	}
}

func TestGarrisonSupportShare(t *testing.T) {
	t.Parallel()

	if got := GarrisonSupportShare(0); got != 0 {
		t.Errorf("GarrisonSupportShare(0) = %v, want none at home", got)
	}
	for ring := 1; ring <= GridRings; ring++ {
		if got := GarrisonSupportShare(ring); got != 1.0/8 {
			t.Errorf("GarrisonSupportShare(%d) = %v, want 1 in 8", ring, got)
		}
	}
}

func TestGarrisonSupport_TheSecondOfEveryEight(t *testing.T) {
	t.Parallel()

	var places []int
	for place := range 24 {
		if GarrisonSupport(1, place) {
			places = append(places, place)
		}
	}
	if want := []int{1, 9, 17}; !slices.Equal(places, want) {
		t.Errorf("Support Ships at %v of a ring-1 line-up, want %v", places, want)
	}
	for place := range 24 {
		if GarrisonSupport(0, place) {
			t.Errorf("a Support Ship at %d at home, want none", place)
		}
	}
}
