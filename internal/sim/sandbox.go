package sim

import (
	"math"
	"strconv"
)

const projectileCapacity = 256

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
	// ShotID and Slot name the shot, so a big space gun ball that ran out
	// bursts with its owner's seed (#72).
	ShotID int
	Slot   int
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

// Sandbox is one ship, its companions and their projectiles, stepped at a
// fixed rate.
type Sandbox struct {
	Wing

	Ship        *Ship
	Projectiles *Pool
	// Previous is the ship's position before the last tick, for smooth
	// drawing between ticks.
	Previous    Vec
	ControlMode ControlMode
	// Frontier is which sectors the ship may fly in (#123).
	Frontier Frontier
	// SquadmateDistance is how far the nearest squadmate is, for the
	// shield's formation bonus and revives; NoSquadmate when there's none.
	SquadmateDistance float64
	// FriendDistance is how far the nearest friendly ship that is up is, for
	// revives; NoSquadmate when there's none.
	FriendDistance float64
	accumulator    float64
}

// NewSandbox returns a ship just below the home planet, with no companions.
func NewSandbox() *Sandbox {
	ship := NewShip(0, HomeSpawnY, DefaultLoadout())

	return &Sandbox{
		Ship:        ship,
		Projectiles: NewPool(projectileCapacity),
		Previous:    Vec{X: ship.X, Y: ship.Y},
		ControlMode: ControlShip,

		SquadmateDistance: NoSquadmate,
		FriendDistance:    NoSquadmate,
	}
}

// Alpha is how far the display is between the last two ticks, from 0 to 1.
func (s *Sandbox) Alpha() float64 {
	return s.accumulator / TickSeconds
}

// AddCompanion adds a companion the server granted, at (x, y). It joins the
// wing's standing orders: the wing follows one set.
func (s *Sandbox) AddCompanion(number int, x, y float64) *Companion {
	s.RemoveCompanion(number)
	orders := DefaultOrders()
	if len(s.Companions) > 0 {
		orders = s.OrdersFor(s.Companions[0])
		orders.OneShot = OneShot{}
	}

	return s.Add(number, x, y, orders)
}

// RemoveCompanion removes a companion, and its shots still in flight, which
// could no longer be reported.
func (s *Sandbox) RemoveCompanion(number int) {
	s.Remove(number)
	s.Projectiles.EndCompanionShots(number)
}

// Advance runs as many fixed ticks as frameSeconds covers, using the same
// input for each. Companions decide from the enemies as drawn.
func (s *Sandbox) Advance(frameSeconds float64, input Input, enemies []BrainEnemy) FrameEvents {
	return s.run(frameSeconds, ToCommand(input), enemies)
}

// AdvanceCommand is [Sandbox.Advance] for a command the browser already
// mapped from its keys, with no companions to fly.
func (s *Sandbox) AdvanceCommand(frameSeconds float64, cmd Command) FrameEvents {
	return s.run(frameSeconds, cmd, nil)
}

func (s *Sandbox) run(frameSeconds float64, cmd Command, enemies []BrainEnemy) FrameEvents {
	var events FrameEvents
	s.accumulator = math.Min(s.accumulator+frameSeconds, TickSeconds*MaxTicksPerFrame)

	for s.accumulator >= TickSeconds {
		s.accumulator -= TickSeconds
		s.tick(cmd, enemies, &events)
	}

	return events
}

func (s *Sandbox) tick(screenCmd Command, enemies []BrainEnemy, events *FrameEvents) {
	s.Observe(s.Ship.Mover())
	s.Previous = Vec{X: s.Ship.X, Y: s.Ship.Y}

	cmd := screenCmd
	if s.ControlMode == ControlShip {
		cmd = RelativeTo(screenCmd, s.Ship.Angle)
	}
	if s.Ship.Downed() {
		cmd = Command{}
		Drift(s.Ship, TickSeconds)
	} else {
		StepShip(s.Ship, cmd, TickSeconds)
	}
	ApplyWorldEdge(s.Ship, TickSeconds)
	ApplyFrontier(s.Ship, s.Frontier, TickSeconds)
	Recover(s.Ship, TickSeconds, s.SquadmateDistance)
	ReviveStep(s.Ship, TickSeconds, s.FriendDistance, s.SquadmateDistance)

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
	for _, shot := range s.Step(enemies, nil) {
		p := s.Projectiles.Spawn(
			ProjectileSpawn{
				Kind:  ProjectileKind(shot.Weapon),
				X:     shot.X,
				Y:     shot.Y,
				Angle: shot.Angle,
			},
			SpawnOptions{Owner: strconv.Itoa(shot.Companion)},
		)
		events.Shots = append(
			events.Shots,
			FiredShot{ShotSpawn: shot.ShotSpawn, ID: p.ShotID, Companion: shot.Companion},
		)
	}
	for _, p := range s.Projectiles.Step(TickSeconds, ProjectileInBounds) {
		events.Expired = append(
			events.Expired,
			Expired{
				Kind: p.Kind, Faction: p.Faction, X: p.X, Y: p.Y,
				ShotID: p.ShotID, Slot: s.Projectiles.SlotOf(p),
			},
		)
	}
	events.Ticks++
}
