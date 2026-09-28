package sim_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

func hold(moveX, moveY, aimX, aimY float64) Command {
	return Command{MoveX: moveX, MoveY: moveY, AimX: aimX, AimY: aimY}
}

func TestNewShip(t *testing.T) {
	t.Parallel()

	ship := NewShip(1, 2, DefaultLoadout())
	if ship.X != 1 || ship.Y != 2 || ship.VX != 0 || ship.VY != 0 {
		t.Errorf("NewShip(1, 2) = %+v, want at rest at (1, 2)", ship)
	}
	if got, want := ship.Angle, -math.Pi/2; got != want {
		t.Errorf("ship.Angle = %v, want %v (facing up)", got, want)
	}
	if got, want := ship.Loadout.Weapon, WeaponAutoCannon; got != want {
		t.Errorf("ship.Loadout.Weapon = %q, want %q", got, want)
	}
}

func TestStepShip_ThrustAccelerates(t *testing.T) {
	t.Parallel()

	ship := NewShip(0, 0, DefaultLoadout())
	StepShip(ship, hold(0, -1, 0, -1000), TickSeconds)
	if ship.VY >= 0 || ship.Y >= 0 || !ship.Thrusting {
		t.Errorf("after thrusting up: %+v, want moving up and thrusting", ship)
	}
}

func TestStepShip_SpeedNeverExceedsTheEngine(t *testing.T) {
	t.Parallel()

	for _, engine := range Engines() {
		ship := NewShip(
			0,
			0,
			Loadout{Weapon: WeaponAutoCannon, Engine: engine, Shield: ShieldFront},
		)
		for range 600 {
			StepShip(ship, hold(1, 0, 0, -1000), TickSeconds)
		}
		speed, maxSpeed := math.Hypot(ship.VX, ship.VY), EngineStatsOf(engine).MaxSpeed
		if speed > maxSpeed+1e-9 || speed <= maxSpeed*0.5 {
			t.Errorf(
				"%s: speed %v, want up to %v and more than half of it",
				engine,
				speed,
				maxSpeed,
			)
		}
	}
}

func TestStepShip_DragStopsACoastingShip(t *testing.T) {
	t.Parallel()

	ship := NewShip(0, 0, DefaultLoadout())
	ship.VX = 200
	for range 600 {
		StepShip(ship, hold(0, 0, 0, -1000), TickSeconds)
	}
	if math.Abs(ship.VX) >= 1 || ship.Thrusting {
		t.Errorf("after coasting: %+v, want at rest", ship)
	}
}

func TestStepShip_FacesTheAim(t *testing.T) {
	t.Parallel()

	ship := NewShip(0, 0, DefaultLoadout())
	StepShip(ship, hold(0, 0, 100, 0), TickSeconds)
	if !closeTo(ship.Angle, 0) {
		t.Errorf("aiming right: angle = %v, want 0", ship.Angle)
	}
	StepShip(ship, hold(0, 0, 0, 100), TickSeconds)
	if !closeTo(ship.Angle, math.Pi/2) {
		t.Errorf("aiming down: angle = %v, want Pi/2", ship.Angle)
	}

	ship.Angle = 1
	StepShip(ship, hold(0, 0, ship.X, ship.Y), TickSeconds)
	if ship.Angle != 1 {
		t.Errorf("aiming at itself: angle = %v, want it kept at 1", ship.Angle)
	}
}

func TestStepShip_RotationSnap(t *testing.T) {
	t.Parallel()

	ship := NewShip(0, 0, DefaultLoadout())
	ship.RotationSnap = 16
	StepShip(ship, hold(0, 0, 100, 12), TickSeconds)
	steps := ship.Angle / (Tau / 16)
	if !closeTo(steps, math.Round(steps)) {
		t.Errorf("angle = %v, want a multiple of Tau/16", ship.Angle)
	}
}

func TestToCommand_DiagonalsAreNoFaster(t *testing.T) {
	t.Parallel()

	cmd := ToCommand(Input{Up: true, Right: true, PointerX: 5, PointerY: 6, Fire: true})
	if !closeTo(math.Hypot(cmd.MoveX, cmd.MoveY), 1) || cmd.MoveX <= 0 || cmd.MoveY >= 0 {
		t.Errorf("up and right: move = (%v, %v), want unit length up-right", cmd.MoveX, cmd.MoveY)
	}
	if cmd.AimX != 5 || cmd.AimY != 6 || !cmd.Fire {
		t.Errorf("ToCommand() = %+v, want the pointer and fire kept", cmd)
	}
	if cmd := ToCommand(Input{Left: true, Right: true}); cmd.MoveX != 0 || cmd.MoveY != 0 {
		t.Errorf("left and right: move = (%v, %v), want none", cmd.MoveX, cmd.MoveY)
	}
}

func TestRelativeTo_UpIsForward(t *testing.T) {
	t.Parallel()

	cmd := RelativeTo(Command{MoveY: -1}, 0)
	if !closeTo(cmd.MoveX, 1) || !closeTo(cmd.MoveY, 0) {
		t.Errorf("up while facing +x: move = (%v, %v), want (1, 0)", cmd.MoveX, cmd.MoveY)
	}
}
