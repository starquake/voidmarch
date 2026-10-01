// Package sim holds the game's rules: ship physics, weapons, projectiles,
// enemy bullet patterns, hits and the companion brains. It is pure: time and
// seeds come in as arguments, so the server and the browser (compiled by
// TinyGo) run the same code and get the same results.
package sim

import "math"

// Tau is a full turn in radians.
const Tau = 2 * math.Pi

const half = 0.5

// Hexagon geometry.
const (
	sqrt3       = 1.7320508075688772
	three       = 3
	threeHalves = 1.5
	twoThirds   = 2.0 / 3
)

// mulberry32's constants, as the client's seededRandom has them.
const (
	mulberryIncrement uint32  = 0x6d2b79f5
	mulberryShiftA            = 15
	mulberryShiftB            = 7
	mulberryShiftC            = 14
	mulberryOr                = 61
	twoToThe32        float64 = 1 << 32
)

// Vec is a point or a direction in world space.
type Vec struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Clamp limits value to [lo, hi].
func Clamp(value, lo, hi float64) float64 {
	return math.Min(hi, math.Max(lo, value))
}

// WrapAngle wraps an angle into [-Pi, Pi).
func WrapAngle(angle float64) float64 {
	return angle - Tau*math.Floor((angle+math.Pi)/Tau)
}

// SnapAngle rounds an angle to the nearest of steps evenly spaced
// directions; 0 steps leaves it free.
func SnapAngle(angle float64, steps int) float64 {
	if steps <= 0 {
		return WrapAngle(angle)
	}
	step := Tau / float64(steps)

	return WrapAngle(round(angle/step) * step)
}

// Normalize scales (x, y) to length 1, or returns zero for a zero vector.
func Normalize(x, y float64) Vec {
	length := math.Hypot(x, y)
	if length == 0 {
		return Vec{}
	}

	return Vec{X: x / length, Y: y / length}
}

// RotateOffset turns an offset in sprite space into world space for a sprite
// facing angle. Sprites face up, so forward is the sprite's -y and right is
// its +x.
func RotateOffset(forward, right, angle float64) Vec {
	cos, sin := math.Cos(angle), math.Sin(angle)

	return Vec{X: forward*cos - right*sin, Y: forward*sin + right*cos}
}

// TriangleWave has period 1: 0 at 0, 1 at 0.25, 0 at 0.5, -1 at 0.75.
func TriangleWave(phase float64) float64 {
	const quarter, four = 0.25, 4
	shifted := phase - quarter

	return 1 - four*math.Abs(round(shifted)-shifted)
}

// round rounds half up, like JavaScript's Math.round, where Go's [math.Round]
// rounds half away from zero.
func round(x float64) float64 {
	r := math.Floor(x)
	if x-r >= half {
		r++
	}

	return r
}

// sign is JavaScript's Math.sign for finite numbers.
func sign(x float64) float64 {
	switch {
	case x > 0:
		return 1
	case x < 0:
		return -1
	default:
		return 0
	}
}

// Random is a deterministic generator (mulberry32) yielding [0, 1): the same
// sequence as the client's seededRandom for the same seed.
type Random struct {
	state uint32
}

// NewRandom returns a generator seeded with seed.
func NewRandom(seed uint32) *Random {
	return &Random{state: seed}
}

// Next returns the next number in [0, 1).
func (r *Random) Next() float64 {
	r.state += mulberryIncrement
	t := r.state
	t = (t ^ t>>mulberryShiftA) * (t | 1)
	t ^= t + (t^t>>mulberryShiftB)*(t|mulberryOr)

	return float64(t^t>>mulberryShiftC) / twoToThe32
}
