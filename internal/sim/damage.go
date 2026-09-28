package sim

import "math"

// TakeHit applies a hit coming from direction fromAngle (radians, where the
// shot came from as seen from the ship): the shield takes it when it covers
// that side and has a charge, else the hull does. It reports whether the
// shield absorbed it.
func TakeHit(ship *Ship, fromAngle float64) bool {
	ship.SinceHit = 0
	ship.hullRegen = 0
	shield := ShieldStatsOf(ship.Loadout.Shield)
	if shield.Covers(fromAngle-ship.Angle) && ship.Shield >= 1 {
		ship.Shield--

		return true
	}
	ship.Damage = min(ship.Damage+1, MaxDamage)

	return false
}

// Recover advances a ship's recovery by dt seconds: after a spell without
// hits the shield recharges, faster with the nearest squadmate
// squadmateDistance away within FormationRadius, and later the hull heals a
// step at a time.
func Recover(ship *Ship, dt, squadmateDistance float64) {
	ship.SinceHit += dt
	// Only the part of dt past a delay counts, however long the step.
	past := func(delay float64) float64 {
		return math.Max(0, math.Min(dt, ship.SinceHit-delay))
	}
	shield := ShieldStatsOf(ship.Loadout.Shield)
	if recharging := past(ShieldRechargeDelay); recharging > 0 && ship.Shield < shield.Strength {
		rate := shield.Strength / shield.Recharge
		if squadmateDistance <= FormationRadius {
			rate *= FormationRecharge
		}
		ship.Shield = math.Min(shield.Strength, ship.Shield+rate*recharging)
	}
	if ship.Damage == 0 {
		ship.hullRegen = 0

		return
	}
	ship.hullRegen += past(HullRegenDelay)
	for ship.hullRegen >= HullRegenEvery && ship.Damage > 0 {
		ship.hullRegen -= HullRegenEvery
		ship.Damage--
	}
}

// HitFrom is the direction a projectile came from, as seen from what it hit.
func HitFrom(p *Projectile) float64 {
	return WrapAngle(p.Angle + math.Pi)
}
