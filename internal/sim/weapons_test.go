package sim_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

func armed(weapon WeaponID, x, y float64) *Ship {
	return NewShip(x, y, Loadout{Weapon: weapon, Engine: EngineBase, Shield: ShieldFront})
}

func TestStepWeapon_FiresOnTheFirstTick(t *testing.T) {
	t.Parallel()

	step := StepWeapon(armed(WeaponAutoCannon, 0, 0), true, TickSeconds)
	if len(step.Shots) != 1 || step.ChargeStarted {
		t.Errorf("StepWeapon() = %+v, want one shot and no charge", step)
	}
}

func TestStepWeapon_KeepsEachWeaponAtItsRate(t *testing.T) {
	t.Parallel()

	for _, weapon := range Weapons() {
		stats := WeaponStatsOf(weapon)
		perVolley := len(stats.Muzzles)
		if stats.Alternate {
			perVolley = 1
		}
		want := int(math.Ceil(3/stats.Interval)) * perVolley
		ship := armed(weapon, 0, 0)
		shots := 0
		for tick := 0.0; tick < 3; tick += TickSeconds {
			shots += len(StepWeapon(ship, true, TickSeconds).Shots)
		}
		if diff := shots - want; diff < -perVolley || diff > perVolley {
			t.Errorf("%s: %d shots in 3 s, want about %d", weapon, shots, want)
		}
	}
}

func TestStepWeapon_BigSpaceGunCharges(t *testing.T) {
	t.Parallel()

	ship := armed(WeaponBigSpaceGun, 0, 0)
	if first := StepWeapon(ship, true, TickSeconds); !first.ChargeStarted || len(first.Shots) != 0 {
		t.Fatalf("first tick = %+v, want a charge and no shot", first)
	}
	elapsed, shots := 0.0, 0
	for shots == 0 && elapsed < 2 {
		elapsed += TickSeconds
		shots = len(StepWeapon(ship, true, TickSeconds).Shots)
	}
	charge := WeaponStatsOf(WeaponBigSpaceGun).Charge
	if shots != 1 || math.Abs(elapsed-charge) > TickSeconds*1.5 {
		t.Errorf("%d shots after %v s, want 1 after the %v s charge", shots, elapsed, charge)
	}
}

func TestStepWeapon_ChargeFiresWhenLetGo(t *testing.T) {
	t.Parallel()

	ship := armed(WeaponBigSpaceGun, 0, 0)
	StepWeapon(ship, true, TickSeconds)
	shots := 0
	for tick := 0.0; tick < 1; tick += TickSeconds {
		shots += len(StepWeapon(ship, false, TickSeconds).Shots)
	}
	if shots != 1 {
		t.Errorf("shots after letting go = %d, want 1", shots)
	}
}

func TestStepWeapon_ChargedShotLeavesFromWhereTheShipIs(t *testing.T) {
	t.Parallel()

	ship := armed(WeaponBigSpaceGun, 0, 0)
	ship.Angle = 0
	StepWeapon(ship, true, TickSeconds)
	ship.X = 500
	var shots []ShotSpawn
	for tick := 0.0; tick < 1 && len(shots) == 0; tick += TickSeconds {
		shots = StepWeapon(ship, true, TickSeconds).Shots
	}
	if len(shots) == 0 || !closeTo(shots[0].X, 516) {
		t.Errorf("shots = %+v, want one leaving at x 516", shots)
	}
}

func TestStepWeapon_IdleDoesNotBankShots(t *testing.T) {
	t.Parallel()

	ship := armed(WeaponAutoCannon, 0, 0)
	StepWeapon(ship, true, TickSeconds)
	for range 120 {
		StepWeapon(ship, false, TickSeconds)
	}
	if ship.Cooldown != 0 {
		t.Errorf("Cooldown = %v, want 0", ship.Cooldown)
	}
	if got := len(StepWeapon(ship, true, TickSeconds).Shots); got != 1 {
		t.Errorf("shots after resting = %d, want 1", got)
	}
}

func TestStepWeapon_AlternatesBarrels(t *testing.T) {
	t.Parallel()

	ship := armed(WeaponAutoCannon, 0, 0)
	ship.Angle = 0
	first := StepWeapon(ship, true, TickSeconds).Shots[0]
	ship.Cooldown = 0
	second := StepWeapon(ship, true, TickSeconds).Shots[0]
	if math.Signbit(first.Y) == math.Signbit(second.Y) || first.Muzzle != 0 || second.Muzzle != 1 {
		t.Errorf("shots %+v then %+v, want muzzles 0 then 1 on opposite sides", first, second)
	}
}

func TestStepWeapon_ShotsLeaveFromTheMuzzle(t *testing.T) {
	t.Parallel()

	ship := armed(WeaponAutoCannon, 100, 50)
	ship.Angle = 0
	shot := StepWeapon(ship, true, TickSeconds).Shots[0]
	if shot.Weapon != WeaponAutoCannon || shot.Angle != 0 || !closeTo(shot.X, 109) ||
		!closeTo(shot.Y, 39.5) {
		t.Errorf("shot = %+v, want an auto cannon shot at (109, 39.5) facing 0", shot)
	}
}

func TestStepWeapon_ZapperFiresBothProngs(t *testing.T) {
	t.Parallel()

	ship := armed(WeaponZapper, 0, 0)
	var shots []ShotSpawn
	for tick := 0.0; tick < 0.5 && len(shots) == 0; tick += TickSeconds {
		shots = StepWeapon(ship, true, TickSeconds).Shots
	}
	if len(shots) != 2 || shots[0].Muzzle != 0 || shots[1].Muzzle != 1 {
		t.Errorf("shots = %+v, want muzzles 0 and 1 at once", shots)
	}
}
