package sim

import "math"

// Body is a circle in motion, a ship or an enemy as bumping sees it.
type Body struct {
	X, Y, VX, VY, Radius float64
}

// Contact is how one body touches another: the normal pointing from the
// other to it, how deep they overlap (below 0 when they're only close), and
// how fast they close along it.
type Contact struct {
	NX, NY, Depth, Closing float64
}

// Touching reports how a touches b, if they overlap or come within
// RammingReach: close enough to ram, though only an overlap pushes. A ship
// sees another as it was, and that one's own client stops it at the touch,
// so a ship that is rammed would rarely see an overlap. When their centers
// coincide, side (+1 or -1) picks which way along x a is pushed, so two ships
// that tell each other apart by side separate instead of both moving the
// same way.
func Touching(a, b Body, side float64) (Contact, bool) {
	dx, dy := a.X-b.X, a.Y-b.Y
	dist := math.Hypot(dx, dy)
	depth := a.Radius + b.Radius - dist
	if depth <= -RammingReach {
		return Contact{}, false
	}
	var nx, ny float64
	if dist > 0 {
		nx, ny = dx/dist, dy/dist
	} else {
		nx = math.Copysign(1, side)
	}
	closing := -((a.VX-b.VX)*nx + (a.VY-b.VY)*ny)

	return Contact{NX: nx, NY: ny, Depth: depth, Closing: closing}, true
}

// Hurts reports whether the bodies closed fast enough to hurt: a ram.
func (c Contact) Hurts() bool {
	return c.Closing >= RammingSpeed
}

// From is the direction the other body is in, as seen from this one, for
// TakeHit.
func (c Contact) From() float64 {
	return math.Atan2(-c.NY, -c.NX)
}

// Apart is b moved out of the contact by share of the overlap (1 when the
// other body stays put, a half when both move), with the part of its
// velocity into the other removed. Bodies that only come close stay as they
// are.
func Apart(b Body, c Contact, share float64) Body {
	if c.Depth <= 0 {
		return b
	}
	b.X += c.NX * c.Depth * share
	b.Y += c.NY * c.Depth * share
	if into := b.VX*c.NX + b.VY*c.NY; into < 0 {
		b.VX -= into * c.NX
		b.VY -= into * c.NY
	}

	return b
}

// ShipBody is a ship as a body.
func ShipBody(s *Ship) Body {
	return Body{X: s.X, Y: s.Y, VX: s.VX, VY: s.VY, Radius: ShipRadius}
}

// MoveTo puts the ship where b is, at b's velocity.
func (s *Ship) MoveTo(b Body) {
	s.X, s.Y, s.VX, s.VY = b.X, b.Y, b.VX, b.VY
}

// Rams remembers when each pair of bodies last rammed, so one collision
// hurts once however many ticks the bodies take to part.
type Rams[K comparable] struct {
	last map[K]float64
}

// Ready reports whether the pair may ram again at now (seconds), and if so
// records it.
func (r *Rams[K]) Ready(pair K, now float64) bool {
	if r.last == nil {
		r.last = map[K]float64{}
	}
	if last, ok := r.last[pair]; ok && now-last < RammingCooldown {
		return false
	}
	r.last[pair] = now

	return true
}

// Forget drops the pairs whose cooldown ended by now, so the record stays
// small.
func (r *Rams[K]) Forget(now float64) {
	for pair, last := range r.last {
		if now-last >= RammingCooldown {
			delete(r.last, pair)
		}
	}
}
