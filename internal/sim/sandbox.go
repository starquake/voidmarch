package sim

import (
	"math"
	"strconv"
)

const (
	projectileCapacity = 256
	// companionSeed seeds each companion's brain from its number, so a replay
	// flies the same.
	companionSeed = 0x5eed
)

// FiredShot is a shot the local ship or one of its companions fired, with
// its id in the projectile pool.
type FiredShot struct {
	ShotSpawn

	ID int
	// Companion is 0 for the player's own ship, n for companion n.
	Companion int
}

// Expired is a projectile that ended this frame, for effects.
type Expired struct {
	Kind    ProjectileKind
	Faction Faction
	X       float64
	Y       float64
}

// FrameEvents is what happened during one frame's ticks, for effects and
// sounds.
type FrameEvents struct {
	Ticks int
	// Charges are the weapons whose charge started this frame.
	Charges []WeaponID
	Shots   []FiredShot
	Expired []Expired
}

// PendingOrders are orders on their way: they take effect after the ticks
// left.
type PendingOrders struct {
	Orders    Orders
	TicksLeft int
}

// Companion is a wingmate flown by a brain (docs/design.md, section 13).
type Companion struct {
	// Number is its number from the server; its seat is "<playerId>/<number>".
	Number int
	Ship   *Ship
	// Previous is its position before the last tick, for smooth drawing.
	Previous Vec
	Orders   Orders
	Pending  *PendingOrders
	// ReactionTicks is how many ticks late it reacts, from its seed.
	ReactionTicks int
	Random        *Random
}

// Sandbox is one ship, its companions and their projectiles, stepped at a
// fixed rate.
type Sandbox struct {
	Ship        *Ship
	Projectiles *Pool
	// Previous is the ship's position before the last tick, for smooth
	// drawing between ticks.
	Previous    Vec
	ControlMode ControlMode
	// Companions are in formation-slot order.
	Companions  []*Companion
	ownerTrail  []Mover
	accumulator float64
}

// NewSandbox returns a ship just below the home planet, with no companions.
func NewSandbox() *Sandbox {
	const startY = 160
	ship := NewShip(0, startY, DefaultLoadout())

	return &Sandbox{
		Ship:        ship,
		Projectiles: NewPool(projectileCapacity),
		Previous:    Vec{X: ship.X, Y: ship.Y},
		ControlMode: ControlShip,
	}
}

// ownerTrailTicks is how many of the owner's recent poses are kept: enough
// for the slowest reaction.
func ownerTrailTicks() int {
	return int(math.Ceil(BrainReactionMax/TickSeconds)) + 1
}

// Alpha is how far the display is between the last two ticks, from 0 to 1.
func (s *Sandbox) Alpha() float64 {
	return s.accumulator / TickSeconds
}

// AddCompanion adds a companion the server granted, at (x, y), with the
// default parts until unlocks exist. It joins the wing's standing orders: the
// wing follows one set.
func (s *Sandbox) AddCompanion(number int, x, y float64) *Companion {
	s.RemoveCompanion(number)
	orders := DefaultOrders()
	if len(s.Companions) > 0 {
		orders = s.OrdersFor(s.Companions[0])
		orders.OneShot = OneShot{}
	}
	seed := uint32(companionSeed + number) //nolint:gosec // companion numbers are small.
	random := NewRandom(seed)
	reaction := BrainReactionMin + random.Next()*(BrainReactionMax-BrainReactionMin)
	c := &Companion{
		Number:        number,
		Ship:          NewShip(x, y, DefaultLoadout()),
		Previous:      Vec{X: x, Y: y},
		Orders:        orders,
		ReactionTicks: int(round(reaction / TickSeconds)),
		Random:        random,
	}
	s.Companions = append(s.Companions, c)

	return c
}

// OrdersFor is the orders a companion will follow: an order on its way, else
// its current ones.
func (*Sandbox) OrdersFor(c *Companion) Orders {
	if c.Pending != nil {
		return c.Pending.Orders
	}

	return c.Orders
}

// Order gives a companion new orders. They arrive after its reaction time
// plus a fresh jitter, so a wing doesn't react as one.
func (*Sandbox) Order(c *Companion, orders Orders) {
	delay := c.ReactionTicks + int(round(c.Random.Next()*BrainOrderJitter/TickSeconds))
	c.Pending = &PendingOrders{Orders: orders, TicksLeft: delay}
}

// RemoveCompanion removes a companion, and its shots still in flight, which
// could no longer be reported.
func (s *Sandbox) RemoveCompanion(number int) {
	for i, c := range s.Companions {
		if c.Number == number {
			s.Companions = append(s.Companions[:i], s.Companions[i+1:]...)

			break
		}
	}
	s.Projectiles.EndCompanionShots(number)
}

// Advance runs as many fixed ticks as frameSeconds covers, using the same
// input for each. Companions decide from the enemies as drawn.
func (s *Sandbox) Advance(frameSeconds float64, input Input, enemies []BrainEnemy) FrameEvents {
	var events FrameEvents
	s.accumulator = math.Min(s.accumulator+frameSeconds, TickSeconds*MaxTicksPerFrame)

	cmd := ToCommand(input)
	for s.accumulator >= TickSeconds {
		s.accumulator -= TickSeconds
		s.tick(cmd, enemies, &events)
	}

	return events
}

func (s *Sandbox) tick(screenCmd Command, enemies []BrainEnemy, events *FrameEvents) {
	s.ownerTrail = append(s.ownerTrail, s.Ship.Mover())
	if len(s.ownerTrail) > ownerTrailTicks() {
		s.ownerTrail = s.ownerTrail[1:]
	}
	s.Previous = Vec{X: s.Ship.X, Y: s.Ship.Y}

	cmd := screenCmd
	if s.ControlMode == ControlShip {
		cmd = RelativeTo(screenCmd, s.Ship.Angle)
	}
	StepShip(s.Ship, cmd, TickSeconds)
	ApplyWorldEdge(s.Ship, TickSeconds)

	weapon := StepWeapon(s.Ship, cmd.Fire, TickSeconds)
	if weapon.ChargeStarted {
		events.Charges = append(events.Charges, s.Ship.Loadout.Weapon)
	}
	for _, shot := range weapon.Shots {
		p := s.Projectiles.Spawn(
			ProjectileSpawn{
				Kind:  ProjectileKind(shot.Weapon),
				X:     shot.X,
				Y:     shot.Y,
				Angle: shot.Angle,
			},
			SpawnOptions{},
		)
		events.Shots = append(events.Shots, FiredShot{ShotSpawn: shot, ID: p.ShotID})
	}
	for slot, c := range s.Companions {
		s.tickCompanion(c, slot, enemies, events)
	}
	for _, p := range s.Projectiles.Step(TickSeconds, ProjectileInBounds) {
		events.Expired = append(
			events.Expired,
			Expired{Kind: p.Kind, Faction: p.Faction, X: p.X, Y: p.Y},
		)
	}
	events.Ticks++
}

func (s *Sandbox) tickCompanion(c *Companion, slot int, enemies []BrainEnemy, events *FrameEvents) {
	c.Previous = Vec{X: c.Ship.X, Y: c.Ship.Y}
	if c.Pending != nil {
		c.Pending.TicksLeft--
		if c.Pending.TicksLeft <= 0 {
			c.Orders = c.Pending.Orders
			c.Pending = nil
		}
	}
	// It sees its owner as they were its reaction time ago.
	seen := s.Ship.Mover()
	if i := max(0, len(s.ownerTrail)-1-c.ReactionTicks); i < len(s.ownerTrail) {
		seen = s.ownerTrail[i]
	}
	step := Think(
		BrainView{Self: c.Ship, Owner: seen, Slot: slot, Enemies: enemies},
		c.Orders,
		c.Random,
	)
	if step.Done {
		c.Orders.OneShot = OneShot{}
	}
	StepShip(c.Ship, step.Command, TickSeconds)
	ApplyWorldEdge(c.Ship, TickSeconds)
	owner := strconv.Itoa(c.Number)
	for _, shot := range StepWeapon(c.Ship, step.Command.Fire, TickSeconds).Shots {
		p := s.Projectiles.Spawn(
			ProjectileSpawn{
				Kind:  ProjectileKind(shot.Weapon),
				X:     shot.X,
				Y:     shot.Y,
				Angle: shot.Angle,
			},
			SpawnOptions{Owner: owner},
		)
		events.Shots = append(
			events.Shots,
			FiredShot{ShotSpawn: shot, ID: p.ShotID, Companion: c.Number},
		)
	}
}
