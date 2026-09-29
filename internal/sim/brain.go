package sim

import (
	"math"
	"slices"
)

// Stance is how a companion positions itself (docs/design.md, section 13).
type Stance string

// The stances.
const (
	StanceEscort     Stance = "escort"
	StanceAggressive Stance = "aggressive"
	StanceDefensive  Stance = "defensive"
	StanceHold       Stance = "hold"
)

// FireOrder is when a companion may shoot.
type FireOrder string

// The fire orders.
const (
	FireFree   FireOrder = "free"
	FireReturn FireOrder = "return"
	FireHold   FireOrder = "hold"
)

// ResourceOrder is whether a companion spends its big shots and its hull
// freely, or saves them.
type ResourceOrder string

// The resource orders.
const (
	ResourcesSpend    ResourceOrder = "spend"
	ResourcesConserve ResourceOrder = "conserve"
)

// OneShotKind is an order that runs until it is done, then gives way to the
// standing orders.
type OneShotKind string

// The one-shot orders; "" is none.
const (
	OneShotNone     OneShotKind = ""
	OneShotFocus    OneShotKind = "focus"
	OneShotRegroup  OneShotKind = "regroup"
	OneShotGoHome   OneShotKind = "goHome"
	OneShotShieldMe OneShotKind = "shieldMe"
)

// OneShot is the one-shot order a companion is carrying out, if any.
type OneShot struct {
	Kind OneShotKind `json:"kind"`
	// EnemyID is the focus target.
	EnemyID int `json:"enemyId"`
}

// Orders are a companion's standing orders, plus the one-shot it is carrying
// out.
type Orders struct {
	Stance    Stance        `json:"stance"`
	Fire      FireOrder     `json:"fire"`
	Resources ResourceOrder `json:"resources"`
	// SupportFirst goes for Support Ships before anything else.
	SupportFirst bool `json:"supportFirst"`
	// HoldX and HoldY are where the hold stance holds.
	HoldX   float64 `json:"holdX"`
	HoldY   float64 `json:"holdY"`
	OneShot OneShot `json:"oneShot"`
}

// DefaultOrders is escorting, weapons free, spending.
func DefaultOrders() Orders {
	return Orders{Stance: StanceEscort, Fire: FireFree, Resources: ResourcesSpend}
}

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
	ID   int       `json:"id"`
	Kind EnemyKind `json:"kind"`
	X    float64   `json:"x"`
	Y    float64   `json:"y"`
	// AttackedWing: it has fired at this wing.
	AttackedWing bool `json:"attackedWing"`
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
}

// Friend is another friendly ship as a companion sees it.
type Friend struct {
	X, Y float64
	// Squadmate is set for a ship of the companion's squadron.
	Squadmate bool
	// Downed is set while the ship is down (#47).
	Downed bool
}

// BrainStep is one decision: the command for this tick, and whether the
// one-shot order is finished.
type BrainStep struct {
	Command Command
	Done    bool
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
	engine := EngineStatsOf(self.Loadout.Engine)
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

// stanceGoal is where the stance puts a companion, and how fast that point
// moves.
func stanceGoal(view *BrainView, orders *Orders) goal {
	switch orders.Stance {
	case StanceHold:
		return goal{point: Vec{X: orders.HoldX, Y: orders.HoldY}}
	case StanceDefensive:
		// Guarding: between the owner and whoever attacks the wing, else close in.
		if attackers := attackersNearOwner(view); len(attackers) > 0 {
			return shieldGoal(view, attackers)
		}

		return goal{
			point:    FormationPoint(view.Owner, view.Slot, BrainTightFormation),
			velocity: ownerVelocity(view.Owner),
		}
	case StanceEscort, StanceAggressive:
		fallthrough
	default:
		return goal{
			point:    FormationPoint(view.Owner, view.Slot, 1),
			velocity: ownerVelocity(view.Owner),
		}
	}
}

// candidates are the enemies the standing orders allow this companion to
// shoot.
func candidates(view *BrainView, orders *Orders) []BrainEnemy {
	attackersOnly := orders.Fire == FireReturn || orders.Stance == StanceDefensive
	inReach := func(e *BrainEnemy) bool {
		switch orders.Stance {
		case StanceAggressive:
			return distance(e.X, e.Y, view.Owner.X, view.Owner.Y) <= BrainLeash
		case StanceHold:
			return distance(e.X, e.Y, view.Self.X, view.Self.Y) <= weaponRange(view.Self)
		case StanceEscort, StanceDefensive:
			fallthrough
		default:
			return distance(e.X, e.Y, view.Owner.X, view.Owner.Y) <= BrainEscortRange
		}
	}
	var out []BrainEnemy
	for i := range view.Enemies {
		e := &view.Enemies[i]
		if inReach(e) && (!attackersOnly || e.AttackedWing) {
			out = append(out, *e)
		}
	}

	return out
}

// chooseTarget is the enemy to shoot, if any. A focus order names it; hold
// fire means none; otherwise Support Ships come first when ordered, the
// weakest first when aggressive, and then the nearest.
func chooseTarget(view *BrainView, orders *Orders) (BrainEnemy, bool) {
	if orders.OneShot.Kind == OneShotFocus {
		i := slices.IndexFunc(
			view.Enemies,
			func(e BrainEnemy) bool { return e.ID == orders.OneShot.EnemyID },
		)
		if i < 0 {
			return BrainEnemy{}, false
		}

		return view.Enemies[i], true
	}
	if orders.Fire == FireHold {
		return BrainEnemy{}, false
	}
	rankOf := func(e *BrainEnemy) rank {
		support, weakness := float64(1), float64(0)
		if orders.SupportFirst && IsSupport(e.Kind) {
			support = 0
		}
		if orders.Stance == StanceAggressive {
			weakness = EnemyHP(e.Kind)
		}

		return rank{support, weakness, distance(e.X, e.Y, view.Self.X, view.Self.Y)}
	}
	var best BrainEnemy
	found := false
	for _, e := range candidates(view, orders) {
		if !found || before(rankOf(&e), rankOf(&best)) {
			best, found = e, true
		}
	}

	return best, found
}

// rankParts is how many criteria a target is ranked on.
const rankParts = 3

// rank orders targets: Support Ships first when ordered, then the weakest
// when aggressive, then the nearest.
type rank [rankParts]float64

// before compares two ranks: the first place they differ decides.
func before(a, b rank) bool {
	for k := range a {
		if a[k] != b[k] {
			return a[k] < b[k]
		}
	}

	return false
}

// attackGoal is a point at attack distance from the target, on the
// companion's side of it.
func attackGoal(self *Ship, target *BrainEnemy) goal {
	away := math.Atan2(self.Y-target.Y, self.X-target.X)

	return goal{point: Vec{
		X: target.X + BrainAttackDistance*math.Cos(away),
		Y: target.Y + BrainAttackDistance*math.Sin(away),
	}}
}

// attackersNearOwner are the attackers near the owner: the fire a shielding
// companion blocks.
func attackersNearOwner(view *BrainView) []BrainEnemy {
	var out []BrainEnemy
	for _, e := range view.Enemies {
		if e.AttackedWing && distance(e.X, e.Y, view.Owner.X, view.Owner.Y) <= BrainEscortRange {
			out = append(out, e)
		}
	}

	return out
}

// shieldGoal is between the owner and the attackers' average position,
// moving with the owner.
func shieldGoal(view *BrainView, attackers []BrainEnemy) goal {
	var sumX, sumY float64
	for _, e := range attackers {
		sumX += e.X
		sumY += e.Y
	}
	cx, cy := sumX/float64(len(attackers)), sumY/float64(len(attackers))
	toward := math.Atan2(cy-view.Owner.Y, cx-view.Owner.X)

	return goal{
		point: Vec{
			X: view.Owner.X + BrainShieldDistance*math.Cos(toward),
			Y: view.Owner.Y + BrainShieldDistance*math.Sin(toward),
		},
		velocity: ownerVelocity(view.Owner),
	}
}

// chooseGoal is where to fly this tick: the one-shot's goal first, then
// falling back, hunting, or the stance.
func chooseGoal(view *BrainView, orders *Orders, target *BrainEnemy) goal {
	switch orders.OneShot.Kind {
	case OneShotRegroup:
		return goal{
			point:    FormationPoint(view.Owner, view.Slot, 1),
			velocity: ownerVelocity(view.Owner),
		}
	case OneShotGoHome:
		return goal{}
	case OneShotShieldMe:
		if attackers := attackersNearOwner(view); len(attackers) > 0 {
			return shieldGoal(view, attackers)
		}
	case OneShotFocus:
		if target != nil {
			return attackGoal(view.Self, target)
		}
	case OneShotNone:
		fallthrough
	default:
	}
	if downed, ok := downedSquadmate(view, orders); ok {
		return goal{point: reviveSpot(view.Self, downed)}
	}
	fallingBack := view.Self.Damage >= BrainBadlyDamaged &&
		(orders.Stance == StanceDefensive || orders.Resources == ResourcesConserve)
	if fallingBack {
		return goal{
			point:    FormationPoint(view.Owner, view.Slot, BrainTightFormation),
			velocity: ownerVelocity(view.Owner),
		}
	}
	if target != nil && orders.Stance == StanceAggressive {
		return attackGoal(view.Self, target)
	}

	return stanceGoal(view, orders)
}

// downedSquadmate is the nearest downed squadmate within BrainReviveRange,
// its owner included, for a companion that isn't holding a point or staying
// out of sight.
func downedSquadmate(view *BrainView, orders *Orders) (Vec, bool) {
	if mode := ModeOf(*orders); mode == ModeHold || mode == ModeStealth {
		return Vec{}, false
	}
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

// oneShotDone reports whether the one-shot order is finished.
func oneShotDone(view *BrainView, orders *Orders, target *BrainEnemy) bool {
	switch orders.OneShot.Kind {
	case OneShotFocus:
		return target == nil
	case OneShotRegroup:
		slot := FormationPoint(view.Owner, view.Slot, 1)

		return distance(view.Self.X, view.Self.Y, slot.X, slot.Y) <= BrainInFormation
	case OneShotGoHome:
		return math.Hypot(view.Self.X, view.Self.Y) <= BrainHomeRadius
	case OneShotShieldMe:
		return len(attackersNearOwner(view)) == 0
	case OneShotNone:
		fallthrough
	default:
		return false
	}
}

// holdsVolley: conserving, the big space gun saves its volleys for Support
// Ships and focus targets.
func holdsVolley(self *Ship, orders *Orders, target *BrainEnemy) bool {
	return orders.Resources == ResourcesConserve &&
		self.Loadout.Weapon == WeaponBigSpaceGun &&
		orders.OneShot.Kind != OneShotFocus &&
		!IsSupport(target.Kind)
}

// Think decides what a companion does this tick; random wobbles its aim.
func Think(view BrainView, orders Orders, random *Random) BrainStep {
	self, owner := view.Self, view.Owner
	var target *BrainEnemy
	// Regrouping disengages: no targets until back in formation.
	if orders.OneShot.Kind != OneShotRegroup {
		if t, ok := chooseTarget(&view, &orders); ok {
			target = &t
		}
	}
	g := chooseGoal(&view, &orders, target)
	move := Arrive(self, spaced(&view, g.point), g.velocity)

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
			math.Abs(WrapAngle(self.Angle-toTarget)) <= BrainFireCone &&
			!holdsVolley(self, &orders, target)
	}

	return BrainStep{
		Command: Command{MoveX: move.X, MoveY: move.Y, AimX: aim.X, AimY: aim.Y, Fire: fire},
		Done:    oneShotDone(&view, &orders, target),
	}
}
