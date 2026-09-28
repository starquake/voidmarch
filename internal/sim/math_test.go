package sim_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

func closeTo(got, want float64) bool {
	return math.Abs(got-want) < 1e-9
}

func TestClamp(t *testing.T) {
	t.Parallel()

	tests := []struct{ value, want float64 }{{5, 3}, {-1, 0}, {2, 2}}
	for _, tc := range tests {
		if got := Clamp(tc.value, 0, 3); got != tc.want {
			t.Errorf("Clamp(%v, 0, 3) = %v, want %v", tc.value, got, tc.want)
		}
	}
}

func TestWrapAngle(t *testing.T) {
	t.Parallel()

	tests := []struct{ angle, want float64 }{
		{0, 0},
		{Tau + 1, 1},
		{-Tau - 1, -1},
		{math.Pi, -math.Pi},
	}
	for _, tc := range tests {
		if got := WrapAngle(tc.angle); !closeTo(got, tc.want) {
			t.Errorf("WrapAngle(%v) = %v, want %v", tc.angle, got, tc.want)
		}
	}
}

func TestSnapAngle(t *testing.T) {
	t.Parallel()

	step := Tau / 16
	tests := []struct {
		name  string
		angle float64
		steps int
		want  float64
	}{
		{name: "free with 0 steps", angle: 0.3, steps: 0, want: 0.3},
		{name: "down to the nearer direction", angle: step * 0.4, steps: 16, want: 0},
		{name: "up to the nearer direction", angle: step * 0.6, steps: 16, want: step},
		{name: "negative angles", angle: -step * 3.2, steps: 16, want: -step * 3},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			if got := SnapAngle(tc.angle, tc.steps); !closeTo(got, tc.want) {
				t.Errorf("SnapAngle(%v, %d) = %v, want %v", tc.angle, tc.steps, got, tc.want)
			}
		})
	}
}

func TestNormalize(t *testing.T) {
	t.Parallel()

	if v := Normalize(3, 4); !closeTo(v.X, 0.6) || !closeTo(v.Y, 0.8) {
		t.Errorf("Normalize(3, 4) = %v, want {0.6 0.8}", v)
	}
	if v := Normalize(0, 0); v != (Vec{}) {
		t.Errorf("Normalize(0, 0) = %v, want zero", v)
	}
}

func TestRotateOffset(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		angle float64
		want  Vec
	}{
		{name: "facing +x, right is +y (down the screen)", angle: 0, want: Vec{X: 10, Y: 2}},
		{
			name:  "facing up, forward is -y and right is +x",
			angle: -math.Pi / 2,
			want:  Vec{X: 2, Y: -10},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := RotateOffset(10, 2, tc.angle)
			if !closeTo(got.X, tc.want.X) || !closeTo(got.Y, tc.want.Y) {
				t.Errorf("RotateOffset(10, 2, %v) = %v, want %v", tc.angle, got, tc.want)
			}
		})
	}
}

func TestTriangleWave(t *testing.T) {
	t.Parallel()

	tests := []struct{ phase, want float64 }{{0, 0}, {0.25, 1}, {0.5, 0}, {0.75, -1}, {1, 0}}
	for _, tc := range tests {
		if got := TriangleWave(tc.phase); !closeTo(got, tc.want) {
			t.Errorf("TriangleWave(%v) = %v, want %v", tc.phase, got, tc.want)
		}
	}
}

func TestRandom_DeterministicInRange(t *testing.T) {
	t.Parallel()

	a, b := NewRandom(42), NewRandom(42)
	for range 100 {
		got := a.Next()
		if want := b.Next(); got != want {
			t.Fatalf("same seed: %v != %v", got, want)
		}
		if got < 0 || got >= 1 {
			t.Fatalf("Next() = %v, want [0, 1)", got)
		}
	}
	if NewRandom(1).Next() == NewRandom(2).Next() {
		t.Error("seeds 1 and 2 start the same")
	}
}
