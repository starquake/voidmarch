package sim

import "math"

// Command is what a ship is told to do for one tick. The move is unit length
// or zero; the aim is a point in world space.
type Command struct {
	MoveX float64 `json:"moveX"`
	MoveY float64 `json:"moveY"`
	AimX  float64 `json:"aimX"`
	AimY  float64 `json:"aimY"`
	Fire  bool    `json:"fire"`
}

// Input is the raw controls for one tick: WASD, the pointer in world space,
// and the fire button.
type Input struct {
	Up       bool    `json:"up"`
	Down     bool    `json:"down"`
	Left     bool    `json:"left"`
	Right    bool    `json:"right"`
	PointerX float64 `json:"pointerX"`
	PointerY float64 `json:"pointerY"`
	Fire     bool    `json:"fire"`
}

// ControlMode says how WASD maps to movement.
type ControlMode string

// The control modes: ship-relative, W thrusts toward the aim; screen-relative,
// W moves up the screen.
const (
	ControlShip   ControlMode = "ship"
	ControlScreen ControlMode = "screen"
)

// ToCommand turns held keys into a movement direction, so diagonals are no
// faster.
func ToCommand(in Input) Command {
	var dx, dy float64
	if in.Right {
		dx++
	}
	if in.Left {
		dx--
	}
	if in.Down {
		dy++
	}
	if in.Up {
		dy--
	}
	move := Normalize(dx, dy)

	return Command{
		MoveX: move.X,
		MoveY: move.Y,
		AimX:  in.PointerX,
		AimY:  in.PointerY,
		Fire:  in.Fire,
	}
}

// RelativeTo turns a screen-relative move into one relative to a ship facing
// angle: up becomes forward and right becomes the ship's right.
func RelativeTo(cmd Command, angle float64) Command {
	move := RotateOffset(-cmd.MoveY, cmd.MoveX, angle)
	cmd.MoveX, cmd.MoveY = move.X, move.Y

	return cmd
}

// Ship is one ship's state.
type Ship struct {
	X  float64
	Y  float64
	VX float64
	VY float64
	// Angle is the facing in radians; 0 is +x, and y grows downward.
	Angle     float64
	Thrusting bool
	Loadout   Loadout
	// Damage is the hits taken.
	Damage int
	// Cooldown is the seconds until the weapon may fire again; at most 0
	// when ready.
	Cooldown float64
	// Charging is the seconds until a charging shot leaves; 0 when not
	// charging.
	Charging float64
	// NextMuzzle is the muzzle an alternating weapon fires next.
	NextMuzzle int
	// RotationSnap is 0 for free rotation, else the number of facing
	// directions.
	RotationSnap int
}

// NewShip returns a ship at (x, y), facing up, with the loadout.
func NewShip(x, y float64, loadout Loadout) *Ship {
	const facingUp = -math.Pi / 2

	return &Ship{X: x, Y: y, Angle: facingUp, Loadout: loadout}
}

// Mover is where a ship is and how it moves, as another ship sees it.
func (s *Ship) Mover() Mover {
	return Mover{X: s.X, Y: s.Y, VX: s.VX, VY: s.VY, Angle: s.Angle}
}

// StepShip advances the ship's movement and aim by dt seconds.
func StepShip(ship *Ship, cmd Command, dt float64) {
	engine := EngineStatsOf(ship.Loadout.Engine)

	ship.Thrusting = cmd.MoveX != 0 || cmd.MoveY != 0
	ship.VX += cmd.MoveX * engine.Acceleration * dt
	ship.VY += cmd.MoveY * engine.Acceleration * dt

	keep := math.Exp(-engine.Drag * dt)
	ship.VX *= keep
	ship.VY *= keep

	if speed := math.Hypot(ship.VX, ship.VY); speed > engine.MaxSpeed {
		ship.VX *= engine.MaxSpeed / speed
		ship.VY *= engine.MaxSpeed / speed
	}

	ship.X += ship.VX * dt
	ship.Y += ship.VY * dt

	dx, dy := cmd.AimX-ship.X, cmd.AimY-ship.Y
	if dx != 0 || dy != 0 {
		ship.Angle = SnapAngle(math.Atan2(dy, dx), ship.RotationSnap)
	}
}
