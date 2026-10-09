package sim

import (
	"math"
	"slices"
)

// Mover is a ship as another ship sees it.
type Mover struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	VX    float64 `json:"vx"`
	VY    float64 `json:"vy"`
	Angle float64 `json:"angle"`
	// Downed is set while the ship is down (#47).
	Downed bool `json:"downed,omitempty"`
}

// BrainEnemy is an enemy as a companion sees it.
type BrainEnemy struct {
	ID int     `json:"id"`
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
}

// BrainView is everything a companion knows when it decides.
type BrainView struct {
	Self  *Ship
	Owner Mover
	// Slot is its place in the formation, an index into FormationSlots.
	Slot    int
	Enemies []BrainEnemy
	// Friends are the other friendly ships it keeps BrainSpacing from: its
	// wingmates and other players' ships.
	Friends []Friend
	// Derelicts are the derelict ships waiting to be rescued (#52).
	Derelicts []Vec
	// SpreadKey tells this companion apart from the others, so they spread
	// over the nearest enemies instead of all picking one (#165).
	SpreadKey uint32
	// Bullets are the enemy bullets in flight, which it dodges (#249).
	Bullets []Bullet
	// GoingHome is set while it flies home, as the server sends a dropped
	// player's companions.
	GoingHome bool
}

// Friend is another friendly ship as a companion sees it.
type Friend struct {
	X, Y float64
	// Squadmate is set for a ship of the companion's squadron.
	Squadmate bool
	// Downed is set while the ship is down (#47).
	Downed bool
}

// BrainStep is one decision: the command for this tick, and whether a
// companion going home is there.
type BrainStep struct {
	Command Command
	Home    bool
}

type goal struct {
	point    Vec
	velocity Vec
}

// FormationPoint is where a formation slot is now, scaled toward the owner by
// scale. Slots past the first few (more companions than slots) repeat the
// pattern on wider rings, so no two companions share a point.
func FormationPoint(owner Mover, slot int, scale float64) Vec {
	slots := FormationSlots()
	offset := slots[slot%len(slots)]
	ring := float64(1 + slot/len(slots))
	world := RotateOffset(offset.Forward*scale*ring, offset.Right*scale*ring, owner.Angle)

	return Vec{X: owner.X + world.X, Y: owner.Y + world.Y}
}

// Arrive is the thrust direction that brings self to goal, arriving with the
// goal's own velocity: it steers the velocity toward the one that closes the
// gap in BrainArriveSeconds, so it slows down as it gets there. It thrusts
// only when a tick of thrust gets closer to that velocity than coasting under
// drag, so it neither jitters at rest nor falls behind at full speed.
func Arrive(self *Ship, target, targetVelocity Vec) Vec {
	engine := self.Loadout.EngineStats()
	wantX := targetVelocity.X + (target.X-self.X)/BrainArriveSeconds
	wantY := targetVelocity.Y + (target.Y-self.Y)/BrainArriveSeconds
	if wantSpeed := math.Hypot(wantX, wantY); wantSpeed > engine.MaxSpeed {
		wantX *= engine.MaxSpeed / wantSpeed
		wantY *= engine.MaxSpeed / wantSpeed
	}
	coast := math.Exp(-engine.Drag * TickSeconds)
	errorX := wantX - self.VX*coast
	errorY := wantY - self.VY*coast
	size := math.Hypot(errorX, errorY)
	if size <= engine.Acceleration*TickSeconds/2 {
		return Vec{}
	}

	return Vec{X: errorX / size, Y: errorY / size}
}

func distance(ax, ay, bx, by float64) float64 {
	return math.Hypot(ax-bx, ay-by)
}

// weaponRange is how far the ship's weapon reaches before its shots expire.
func weaponRange(self *Ship) float64 {
	stats := WeaponStatsOf(self.Loadout.Weapon).ProjectileStats

	return Traveled(stats, stats.Lifetime)
}

func ownerVelocity(owner Mover) Vec {
	return Vec{X: owner.VX, Y: owner.VY}
}

// candidates are the enemies a companion may shoot: those near its owner.
func candidates(view *BrainView) []BrainEnemy {
	var out []BrainEnemy
	for _, e := range view.Enemies {
		if distance(e.X, e.Y, view.Owner.X, view.Owner.Y) <= BrainEscortRange {
			out = append(out, e)
		}
	}

	return out
}

// chooseTarget is the enemy to shoot, if any: the nearest of the candidates,
// spread over the nearest few.
func chooseTarget(view *BrainView) (BrainEnemy, bool) {
	self := view.Self
	reach := func(e *BrainEnemy) float64 { return distance(e.X, e.Y, self.X, self.Y) }
	ranked := candidates(view)
	if len(ranked) == 0 {
		return BrainEnemy{}, false
	}
	slices.SortStableFunc(ranked, func(a, b BrainEnemy) int {
		switch ra, rb := reach(&a), reach(&b); {
		case ra < rb:
			return -1
		case rb < ra:
			return 1
		default:
			return 0
		}
	})

	return spreadPick(ranked, reach, view.SpreadKey), true
}

// spreadPick is one of the nearest few of ranked, nearest first, for the
// companion with key: among those not much farther than the nearest, the one
// its key hashes lowest with. The pick is pure and holds while the same
// enemies are there, and companions with different keys spread over them
// (#165).
func spreadPick(ranked []BrainEnemy, reach func(*BrainEnemy) float64, key uint32) BrainEnemy {
	best := ranked[0]
	nearest := reach(&best)
	pick, lowest := best, spreadHash(key, best.ID)
	for i := 1; i < min(len(ranked), TargetSpreadCount); i++ {
		e := ranked[i]
		if reach(&e) > nearest*TargetSpreadReach {
			break
		}
		if h := spreadHash(key, e.ID); h < lowest {
			pick, lowest = e, h
		}
	}

	return pick
}

// The constants of the mix spreadHash uses: the golden ratio's, then
// MurmurHash3's 32-bit finalizer.
const (
	goldenRatio32 = 0x9e3779b9
	murmurMul1    = 0x85ebca6b
	murmurMul2    = 0xc2b2ae35
	murmurShift1  = 16
	murmurShift2  = 13
)

// spreadHash mixes a companion's key with an enemy's id.
func spreadHash(key uint32, id int) uint32 {
	h := key ^ uint32(id)*goldenRatio32 //nolint:gosec // ids are small; any wrap is a fine mix.
	h ^= h >> murmurShift1
	h *= murmurMul1
	h ^= h >> murmurShift2
	h *= murmurMul2
	h ^= h >> murmurShift1

	return h
}

// chooseGoal is where to fly this tick: home when going home, else beside a
// downed squadmate or a derelict in reach, else its formation slot.
func chooseGoal(view *BrainView) goal {
	if view.GoingHome {
		return goal{}
	}
	if downed, ok := downedSquadmate(view); ok {
		return goal{point: reviveSpot(view.Self, downed)}
	}
	if derelict, ok := nearestDerelict(view); ok {
		return goal{point: reviveSpot(view.Self, derelict)}
	}

	return goal{
		point:    FormationPoint(view.Owner, view.Slot, 1),
		velocity: ownerVelocity(view.Owner),
	}
}

// downedSquadmate is the nearest downed squadmate within BrainReviveRange,
// its owner included.
func downedSquadmate(view *BrainView) (Vec, bool) {
	self := view.Self
	var nearest Vec
	best := math.Inf(1)
	consider := func(x, y float64) {
		if d := distance(self.X, self.Y, x, y); d <= BrainReviveRange && d < best {
			nearest, best = Vec{X: x, Y: y}, d
		}
	}
	if view.Owner.Downed {
		consider(view.Owner.X, view.Owner.Y)
	}
	for _, f := range view.Friends {
		if f.Squadmate && f.Downed {
			consider(f.X, f.Y)
		}
	}

	return nearest, best <= BrainReviveRange
}

// nearestDerelict is the nearest derelict within BrainReviveRange: a
// companion rescues one the way it revives a squadmate.
func nearestDerelict(view *BrainView) (Vec, bool) {
	self := view.Self
	var nearest Vec
	best := math.Inf(1)
	for _, d := range view.Derelicts {
		if dist := distance(self.X, self.Y, d.X, d.Y); dist <= BrainReviveRange && dist < best {
			nearest, best = d, dist
		}
	}

	return nearest, best <= BrainReviveRange
}

// ComesToRevive reports whether a companion at self comes to revive a ship
// downed at (x, y), as chooseGoal decides it: one that is up, within
// BrainReviveRange.
func ComesToRevive(self *Ship, x, y float64) bool {
	return !self.Downed() && distance(self.X, self.Y, x, y) <= BrainReviveRange
}

// reviveSpot is where a companion hovers to revive a downed ship: on its
// own side of it, BrainSpacing out, inside ReviveRadius.
func reviveSpot(self *Ship, downed Vec) Vec {
	dx, dy := self.X-downed.X, self.Y-downed.Y
	d := math.Hypot(dx, dy)
	if d == 0 {
		dx, dy, d = 1, 0, 1
	}

	return Vec{X: downed.X + dx/d*BrainSpacing, Y: downed.Y + dy/d*BrainSpacing}
}

// spaced is the goal point moved away from each friend closer than
// BrainSpacing, by how much closer it is, so companions sent to one place
// spread out instead of bumping; and out of BrainOwnerSpacing around its
// owner, who it flies and brakes with. A downed owner is left out: the
// companion comes close to revive them.
func spaced(view *BrainView, point Vec) Vec {
	for _, f := range view.Friends {
		point = awayFrom(view, point, f.X, f.Y, BrainSpacing)
	}
	if !view.Owner.Downed {
		point = outside(view, point, view.Owner.X, view.Owner.Y, BrainOwnerSpacing)
	}

	return point
}

// outside is point moved out to room from (x, y) when it's closer, along the
// line from there to it; a point right on (x, y) goes toward the companion.
func outside(view *BrainView, point Vec, x, y, room float64) Vec {
	dx, dy := point.X-x, point.Y-y
	d := math.Hypot(dx, dy)
	if d >= room {
		return point
	}
	if d == 0 {
		dx, dy = view.Self.X-x, view.Self.Y-y
		if d = math.Hypot(dx, dy); d == 0 {
			turn := float64(view.Slot) * BrainSplitTurn
			dx, dy, d = math.Cos(turn), math.Sin(turn), 1
		}
	}

	return Vec{X: x + dx/d*room, Y: y + dy/d*room}
}

// awayFrom is point moved away from (x, y) by how much closer than room the
// companion is to it.
func awayFrom(view *BrainView, point Vec, x, y, room float64) Vec {
	self := view.Self
	dx, dy := self.X-x, self.Y-y
	d := math.Hypot(dx, dy)
	if d >= room {
		return point
	}
	if d == 0 {
		turn := float64(view.Slot) * BrainSplitTurn
		dx, dy, d = math.Cos(turn), math.Sin(turn), 1
	}
	push := room - d
	point.X += dx / d * push
	point.Y += dy / d * push

	return point
}

// Think decides what a companion does this tick; random wobbles its aim.
func Think(view BrainView, random *Random) BrainStep {
	self, owner := view.Self, view.Owner
	var target *BrainEnemy
	if t, ok := chooseTarget(&view); ok {
		target = &t
	}
	g := chooseGoal(&view)
	g.point = spaced(&view, g.point)
	move := dodge(&view, g, Arrive(self, g.point, g.velocity))

	var aim Vec
	fire := false
	if target == nil {
		look := RotateOffset(BrainLookAhead, 0, owner.Angle)
		aim = Vec{X: self.X + look.X, Y: self.Y + look.Y}
	} else {
		toTarget := math.Atan2(target.Y-self.Y, target.X-self.X)
		wobble := (random.Next()*2 - 1) * BrainAimJitter
		reach := distance(self.X, self.Y, target.X, target.Y)
		aim = Vec{
			X: self.X + reach*math.Cos(toTarget+wobble),
			Y: self.Y + reach*math.Sin(toTarget+wobble),
		}
		fire = reach <= weaponRange(self) &&
			math.Abs(WrapAngle(self.Angle-toTarget)) <= BrainFireCone
	}

	return BrainStep{
		Command: Command{MoveX: move.X, MoveY: move.Y, AimX: aim.X, AimY: aim.Y, Fire: fire},
		Home:    view.GoingHome && math.Hypot(self.X, self.Y) <= BrainHomeRadius,
	}
}
