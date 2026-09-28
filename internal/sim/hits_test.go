package sim_test

import (
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

func hitTargets() []Target[int] {
	return []Target[int]{{ID: 1, Radius: 10}, {ID: 2, X: 100, Radius: 12}}
}

func TestHitTarget(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		x, y float64
		want int
	}{
		{name: "inside the first", x: 5, y: 5, want: 1},
		{name: "inside the second", x: 95, y: 3, want: 2},
		{name: "touching, with the shot's own size", x: 10 + ShotRadius, want: 1},
		{name: "just past it", x: 10 + ShotRadius + 0.5, want: 0},
		{name: "a miss", x: 50, y: 50, want: 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, ok := HitTarget(tc.x, tc.y, hitTargets())
			if tc.want == 0 && ok || tc.want != 0 && (!ok || got.ID != tc.want) {
				t.Errorf("HitTarget(%v, %v) = %v, %t, want %d", tc.x, tc.y, got.ID, ok, tc.want)
			}
		})
	}
	if _, ok := HitTarget(0, 0, []Target[int]{}); ok {
		t.Error("HitTarget() with no targets hit one")
	}
}

func TestHitTargetAlong(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		x0, y0, x1, y1 float64
		want           int
	}{
		{name: "a fast shot hits what it passed", x0: -50, y0: 2, x1: 50, y1: 2, want: 1},
		{name: "a path past everything", x0: -50, y0: 20, x1: 50, y1: 20, want: 0},
		{name: "the nearer target first, going left", x0: 150, x1: -50, want: 2},
		{name: "the nearer target first, going right", x0: -50, x1: 150, want: 1},
		{name: "a path ending short", x0: -50, x1: -20, want: 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, ok := HitTargetAlong(tc.x0, tc.y0, tc.x1, tc.y1, hitTargets())
			if tc.want == 0 && ok || tc.want != 0 && (!ok || got.ID != tc.want) {
				t.Errorf("HitTargetAlong() = %v, %t, want %d", got.ID, ok, tc.want)
			}
		})
	}
}
