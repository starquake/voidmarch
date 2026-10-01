package game_test

import (
	"slices"
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
)

func TestSectors_AJoinerIsToldTheClearedOnes(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t, WithClearedSectors([]string{"E3", "C3", "Z9"}))
	_, w := join(t, hub, "a")

	if got, want := w.GetClearedSectors(), []string{"C3", "E3"}; !slices.Equal(got, want) {
		t.Errorf("ClearedSectors = %v, want %v: sorted, and off-grid names dropped", got, want)
	}
}
