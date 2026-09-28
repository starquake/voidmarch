package sim

import "math"

// ShotSpawn is a projectile to create: where, which way, from which weapon
// and barrel.
type ShotSpawn struct {
	Weapon WeaponID
	Muzzle int
	X      float64
	Y      float64
	Angle  float64
}

// WeaponStep is what a weapon did during one tick.
type WeaponStep struct {
	// ChargeStarted: a charging weapon's trigger was pulled; its shot leaves
	// after the charge.
	ChargeStarted bool
	Shots         []ShotSpawn
}

// StepWeapon advances the weapon by dt and returns what it did this tick.
// Holding fire keeps the cadence exact across ticks; a charging weapon fires
// when its charge completes, even if the trigger was let go.
//
//nolint:revive // fire is the trigger held this tick, not a mode.
func StepWeapon(ship *Ship, fire bool, dt float64) WeaponStep {
	stats := WeaponStatsOf(ship.Loadout.Weapon)
	var step WeaponStep

	ship.Cooldown -= dt
	if ship.Charging > 0 {
		ship.Charging -= dt
		if ship.Charging <= 0 {
			ship.Charging = 0
			step.Shots = fireVolley(ship, stats, step.Shots)
		}

		return step
	}
	if !fire {
		ship.Cooldown = math.Max(ship.Cooldown, 0)

		return step
	}

	for ship.Cooldown <= 0 {
		ship.Cooldown += stats.Interval
		if stats.Charge > 0 {
			ship.Charging = stats.Charge
			step.ChargeStarted = true

			break
		}
		step.Shots = fireVolley(ship, stats, step.Shots)
	}

	return step
}

// fireVolley fires one muzzle, or all of them, from the ship's current
// position and aim.
func fireVolley(ship *Ship, stats WeaponStats, shots []ShotSpawn) []ShotSpawn {
	count := len(stats.Muzzles)
	muzzles := make([]int, 0, count)
	if stats.Alternate {
		muzzles = append(muzzles, ship.NextMuzzle%count)
	} else {
		for i := range count {
			muzzles = append(muzzles, i)
		}
	}
	ship.NextMuzzle = (ship.NextMuzzle + 1) % count

	for _, index := range muzzles {
		muzzle := stats.Muzzles[index]
		offset := RotateOffset(muzzle.Forward, muzzle.Right, ship.Angle)
		shots = append(shots, ShotSpawn{
			Weapon: ship.Loadout.Weapon,
			Muzzle: index,
			X:      ship.X + offset.X,
			Y:      ship.Y + offset.Y,
			Angle:  ship.Angle,
		})
	}

	return shots
}
