package sim

import "math"

// Target is something a projectile can hit: a circle in world space.
type Target[ID any] struct {
	ID     ID      `json:"id"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Radius float64 `json:"radius"`
}

// HitTarget is the first target a projectile at (x, y) touches, if any.
func HitTarget[ID any](x, y float64, targets []Target[ID]) (Target[ID], bool) {
	return HitTargetAlong(x, y, x, y, targets)
}

// HitTargetAlong is the first target a projectile touches on its way from
// (x0, y0) to (x1, y1), so a fast shot can't skip past a small target between
// two checks.
func HitTargetAlong[ID any](x0, y0, x1, y1 float64, targets []Target[ID]) (Target[ID], bool) {
	dx, dy := x1-x0, y1-y0
	lengthSquared := dx*dx + dy*dy
	var first Target[ID]
	found := false
	firstAlong := math.Inf(1)
	for _, t := range targets {
		var along float64
		if lengthSquared != 0 {
			along = Clamp(((t.X-x0)*dx+(t.Y-y0)*dy)/lengthSquared, 0, 1)
		}
		touches := math.Hypot(t.X-(x0+along*dx), t.Y-(y0+along*dy)) <= t.Radius+ShotRadius
		if touches && along < firstAlong {
			first, found, firstAlong = t, true, along
		}
	}

	return first, found
}
