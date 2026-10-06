package sim

import "math"

// dodgeSamples is how many pieces a companion checks the look-ahead in; a
// bullet's path is straight between them.
const dodgeSamples = 10

// Bullet is an enemy bullet as a companion sees it (#249): where it is, how
// fast it flies, and how long it has flown.
type Bullet struct {
	X, Y   float64
	VX, VY float64
	Age    float64
}

// BulletOf is p as a companion sees it, with its velocity over the next tick.
func BulletOf(p *Projectile) Bullet {
	next := PositionAt(p, p.Age+TickSeconds)

	return Bullet{
		X:   p.X,
		Y:   p.Y,
		VX:  (next.X - p.X) / TickSeconds,
		VY:  (next.Y - p.Y) / TickSeconds,
		Age: p.Age,
	}
}

// dodge is move, unless the course it is on, arriving at g, meets a bullet
// the companion has noticed within BrainDodgeLookAhead; then it is the one of
// BrainDodgeWays ways around move to thrust that meets the fewest, and those
// latest, the ways nearest move first, so it keeps to its course as far as it
// can.
func dodge(view *BrainView, g goal, move Vec) Vec {
	threats := noticed(view)
	if len(threats) == 0 {
		return move
	}
	self := view.Self
	reach := clearance(self)
	var path track
	path.arrive(self, g)
	if danger(&path, threats, reach) == 0 {
		return move
	}
	var start float64
	if move != (Vec{}) {
		start = math.Atan2(move.Y, move.X)
	}
	thrust := thrustOf(self)
	var best Vec
	worst := math.Inf(1)
	for k := range BrainDodgeWays {
		// 0, 1, -1, 2, -2, ... ways off the move: on a tie, the nearer one wins.
		turn := math.Floor(float64(k+1)*half) * Tau / BrainDodgeWays
		if k%2 == 0 {
			turn = -turn
		}
		way := Vec{X: math.Cos(start + turn), Y: math.Sin(start + turn)}
		thrust.along(way, &path)
		if d := danger(&path, threats, reach); d < worst {
			best, worst = way, d
		}
	}

	return best
}

// noticed are the bullets a companion has seen coming: within
// BrainDodgeRadius, and flying at least BrainDodgeReaction.
func noticed(view *BrainView) []Bullet {
	var out []Bullet
	self := view.Self
	for i := range view.Bullets {
		b := &view.Bullets[i]
		dx, dy := b.X-self.X, b.Y-self.Y
		if b.Age >= BrainDodgeReaction && dx*dx+dy*dy <= BrainDodgeRadius*BrainDodgeRadius {
			out = append(out, *b)
		}
	}

	return out
}

// sampleTime is how far into the look-ahead sample k is.
func sampleTime(k int) float64 {
	return BrainDodgeLookAhead * float64(k) / dodgeSamples
}

// track is where a ship will be at each sample of the look-ahead.
type track [dodgeSamples + 1]Vec

// arrive is self's track to g, closing on it as Arrive steers: the gap
// shrinking by e every BrainArriveSeconds, while g moves on.
func (p *track) arrive(self *Ship, g goal) {
	for k := range p {
		t := sampleTime(k)
		left := math.Exp(-t / BrainArriveSeconds)
		p[k] = Vec{
			X: g.point.X + g.velocity.X*t + (self.X-g.point.X)*left,
			Y: g.point.Y + g.velocity.Y*t + (self.Y-g.point.Y)*left,
		}
	}
}

// thrust is a ship's flight over the look-ahead under full thrust one way,
// with drag: at sample k, its start plus drift[k], plus push[k] the way. It
// leaves out the top speed, which a short dodge rarely reaches.
type thrust struct {
	start Vec
	drift [dodgeSamples + 1]Vec
	push  [dodgeSamples + 1]float64
}

// thrustOf is self's thrust.
func thrustOf(self *Ship) thrust {
	engine := self.Loadout.EngineStats()
	f := thrust{start: Vec{X: self.X, Y: self.Y}}
	for k := range f.push {
		t := sampleTime(k)
		coasted := t
		if engine.Drag > 0 {
			coasted = (1 - math.Exp(-engine.Drag*t)) / engine.Drag
		}
		f.drift[k] = Vec{X: self.VX * coasted, Y: self.VY * coasted}
		if engine.Drag > 0 {
			f.push[k] = engine.Acceleration * (t - coasted) / engine.Drag
		} else {
			f.push[k] = half * engine.Acceleration * t * t
		}
	}

	return f
}

// along fills p with the track thrusting way.
func (f *thrust) along(way Vec, p *track) {
	for k := range p {
		p[k] = Vec{
			X: f.start.X + f.drift[k].X + f.push[k]*way.X,
			Y: f.start.Y + f.drift[k].Y + f.push[k]*way.Y,
		}
	}
}

// clearance is how near, center to center, a bullet meets self: at its
// shield or its hull, whichever is wider, plus BrainDodgeMargin.
func clearance(self *Ship) float64 {
	return math.Max(ShipRadius, self.Loadout.ShieldStats().Radius) + ShotRadius + BrainDodgeMargin
}

// danger is how badly the track meets threats: each bullet that comes within
// reach of it counts 1, and up to 1 more the sooner it does.
func danger(p *track, threats []Bullet, reach float64) float64 {
	var total float64
	for i := range threats {
		b := &threats[i]
		var lastX, lastY float64
		for k := range p {
			t := sampleTime(k)
			x, y := b.X+b.VX*t-p[k].X, b.Y+b.VY*t-p[k].Y
			if k > 0 && nearOrigin(lastX, lastY, x, y, reach) {
				total += 1 + (1 - sampleTime(k-1)/BrainDodgeLookAhead)

				break
			}
			lastX, lastY = x, y
		}
	}

	return total
}

// nearOrigin reports whether the segment from (x0, y0) to (x1, y1) passes
// within reach of the origin.
func nearOrigin(x0, y0, x1, y1, reach float64) bool {
	dx, dy := x1-x0, y1-y0
	var along float64
	if size := dx*dx + dy*dy; size > 0 {
		along = math.Max(0, math.Min(1, -(x0*dx+y0*dy)/size))
	}
	x, y := x0+dx*along, y0+dy*along

	return x*x+y*y <= reach*reach
}
