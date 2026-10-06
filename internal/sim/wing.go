package sim

import "math"

// companionSeed seeds each companion's brain from its number, so a replay
// flies the same.
const companionSeed = 0x5eed

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

// CompanionShot is a shot a companion fired this tick.
type CompanionShot struct {
	ShotSpawn

	Companion int
}

// Wing is the companions that fly with one owner, stepped at the sim's fixed
// rate. The owner is whoever feeds Observe: the local ship, or a player's
// latest reported state on the server.
type Wing struct {
	// Companions are in formation-slot order.
	Companions []*Companion
	// Derelicts are the derelict ships its companions may rescue, set before
	// each Step (#52).
	Derelicts []Vec
	// Bullets are the enemy bullets in flight, set before each Step, which
	// its companions dodge (#249).
	Bullets []Bullet
	// Frontier is which sectors its companions may fly in (#123).
	Frontier Frontier
	// Key tells this wing's companions apart from other wings', so all of a
	// squadron's companions spread over the enemies (#165).
	Key        uint32
	ownerTrail []Mover
}

// ownerTrailTicks is how many of the owner's recent poses are kept: enough
// for the slowest reaction.
func ownerTrailTicks() int {
	return int(math.Ceil(BrainReactionMax/TickSeconds)) + 1
}

// Add puts companion number in the wing at (x, y) under orders, with the
// default parts; [Companion.Fit] gives it others.
func (w *Wing) Add(number int, x, y float64, orders Orders) *Companion {
	w.Remove(number)
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
	w.Companions = append(w.Companions, c)

	return c
}

// Fit gives the companion a loadout, its shield charged for it.
func (c *Companion) Fit(l Loadout) {
	c.Ship.Loadout = l
	c.Ship.Shield = l.ShieldStats().Strength
}

// Remove takes companion number out of the wing, and reports whether it was
// there.
func (w *Wing) Remove(number int) bool {
	for i, c := range w.Companions {
		if c.Number == number {
			w.Companions = append(w.Companions[:i], w.Companions[i+1:]...)

			return true
		}
	}

	return false
}

// Find is companion number, or nil.
func (w *Wing) Find(number int) *Companion {
	for _, c := range w.Companions {
		if c.Number == number {
			return c
		}
	}

	return nil
}

// OrdersFor is the orders a companion will follow: an order on its way, else
// its current ones.
func (*Wing) OrdersFor(c *Companion) Orders {
	if c.Pending != nil {
		return c.Pending.Orders
	}

	return c.Orders
}

// Order gives a companion new orders. They arrive after its reaction time
// plus a fresh jitter, so a wing doesn't react as one.
func (*Wing) Order(c *Companion, orders Orders) {
	delay := c.ReactionTicks + int(round(c.Random.Next()*BrainOrderJitter/TickSeconds))
	c.Pending = &PendingOrders{Orders: orders, TicksLeft: delay}
}

// Observe records where the owner is this tick; companions see it a
// reaction time later.
func (w *Wing) Observe(owner Mover) {
	w.ownerTrail = append(w.ownerTrail, owner)
	if len(w.ownerTrail) > ownerTrailTicks() {
		w.ownerTrail = w.ownerTrail[1:]
	}
}

// Step flies every companion one tick against the enemies as they see them,
// keeping clear of its wingmates and the others (other players' ships and
// their companions), and returns the shots they fired. Observe first: a wing that has
// never seen its owner holds still.
func (w *Wing) Step(enemies []BrainEnemy, others []Friend) []CompanionShot {
	if len(w.ownerTrail) == 0 {
		return nil
	}
	var shots []CompanionShot
	for slot, c := range w.Companions {
		c.Previous = Vec{X: c.Ship.X, Y: c.Ship.Y}
		if c.Pending != nil {
			c.Pending.TicksLeft--
			if c.Pending.TicksLeft <= 0 {
				c.Orders = c.Pending.Orders
				c.Pending = nil
			}
		}
		// It sees its owner as they were its reaction time ago.
		seen := w.ownerTrail[max(0, len(w.ownerTrail)-1-c.ReactionTicks)]
		friends := w.friendsOf(c, others)
		var step BrainStep
		if c.Ship.Downed() {
			Drift(c.Ship, TickSeconds)
		} else {
			step = Think(
				BrainView{
					Self:      c.Ship,
					Owner:     seen,
					Slot:      slot,
					Enemies:   enemies,
					Friends:   friends,
					Derelicts: w.Derelicts,
					Bullets:   w.Bullets,
					SpreadKey: spreadKey(w.Key, c.Number),
				},
				c.Orders,
				c.Random,
			)
			if step.Done {
				c.Orders.OneShot = OneShot{}
			}
			StepShip(c.Ship, step.Command, TickSeconds)
		}
		ApplyWorldEdge(c.Ship, TickSeconds)
		ApplyFrontier(c.Ship, w.Frontier, TickSeconds)
		// Its owner is a squadmate: flying with them gives the formation bonus.
		Recover(
			c.Ship,
			TickSeconds,
			math.Hypot(c.Ship.X-seen.X, c.Ship.Y-seen.Y),
		)
		// Its owner can revive it too, as a squadmate.
		owner := Friend{X: seen.X, Y: seen.Y, Squadmate: true, Downed: seen.Downed}
		friend, squadmate := Helpers(c.Ship.X, c.Ship.Y, append(friends, owner))
		ReviveStep(c.Ship, TickSeconds, friend, squadmate)
		for _, shot := range StepWeapon(c.Ship, step.Command.Fire, TickSeconds).Shots {
			shots = append(shots, CompanionShot{ShotSpawn: shot, Companion: c.Number})
		}
	}

	return shots
}

// friendsOf are the ships c keeps clear of: the others and its wingmates.
// Its owner isn't one: the formation already keeps it at a distance.
func (w *Wing) friendsOf(c *Companion, others []Friend) []Friend {
	friends := make([]Friend, 0, len(others)+len(w.Companions)+1)
	friends = append(friends, others...)
	for _, mate := range w.Companions {
		if mate != c {
			friends = append(friends, Friend{
				X: mate.Ship.X, Y: mate.Ship.Y, Squadmate: true, Downed: mate.Ship.Downed(),
			})
		}
	}

	return friends
}

// spreadKey is a companion's key for spreading over the enemies: its wing's,
// moved on by its number.
func spreadKey(wing uint32, number int) uint32 {
	return wing + uint32(number) //nolint:gosec // companion numbers are small.
}
